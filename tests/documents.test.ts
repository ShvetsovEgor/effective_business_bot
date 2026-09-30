import { expect, it, vi } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context,FileAttachment } from '@maxhub/max-bot-api';
import type { Message } from '@maxhub/max-bot-api/types';
import { Repository } from '../src/db/repository.js';
import { createBot } from '../src/bot/create-bot.js';
import { createDocumentDelivery } from '../src/bot/messages/documents.js';
import { documentPath,documentScreen } from '../src/services/document-catalog.js';
it('approved local document sends once per request and unknown paths cannot be requested',async()=>{
 const root=mkdtempSync(join(tmpdir(),'max-doc-'));const before=process.env.DOCUMENTS_PATH;process.env.DOCUMENTS_PATH=root;
 const repo=new Repository(':memory:');const bot=createBot('test',repo);
 const msg:Message={recipient:{chat_id:1,user_id:1,chat_type:'dialog',post_id:null},timestamp:1,body:{mid:'file-msg',seq:1,text:''}};
 const ctx=new Context({update_type:'message_created',timestamp:1,message:msg},bot.api);
 const upload=vi.spyOn(bot.api,'uploadFile').mockResolvedValue(new FileAttachment({token:'test-file-token'}));
 const send=vi.spyOn(bot.api,'sendMessageToUser').mockResolvedValue(msg);
 try{
 expect(documentScreen('r11001').text).toContain('ещё не загружен');
 writeFileSync(join(root,'R11001.pdf'),'test fixture, not a legal document');
 expect(documentPath('../../.env')).toBeNull();expect(documentPath('r11001')).toBe(join(root,'R11001.pdf'));
 const deliver=createDocumentDelivery(repo);const screen={text:'Файл',buttons:[{text:'Назад',action:'nonce|resume'}],documentId:'r11001'};
 await deliver(ctx,1,screen);await deliver(ctx,1,screen);
 expect(upload).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]?.[2]?.attachments?.[0]?.type).toBe('file');
 }finally{repo.close();if(before===undefined)delete process.env.DOCUMENTS_PATH;else process.env.DOCUMENTS_PATH=before;rmSync(root,{recursive:true,force:true});}
});
