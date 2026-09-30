import { statSync } from 'node:fs';
import type { Context, FileAttachment } from '@maxhub/max-bot-api';
import type { Repository } from '../../db/repository.js';
import type { Screen } from './types.js';
import { documentPath } from '../../services/document-catalog.js';
import { documents } from '../../data/documents.js';

export function createDocumentDelivery(repo:Repository) {
  repo.db.exec('CREATE TABLE IF NOT EXISTS document_deliveries(user_id TEXT NOT NULL,request_id TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(user_id,request_id))');
  const uploads=new Map<string,FileAttachment>();
  return async(ctx:Context,userId:number,screen:Screen)=>{
    if(!screen.documentId)return;
    const path=documentPath(screen.documentId);if(!path)return;
    const key=screen.buttons.find(b=>'action'in b);const request=`${screen.documentId}:${key&&'action'in key?key.action:screen.text}`;
    if(repo.db.prepare('SELECT 1 FROM document_deliveries WHERE user_id=? AND request_id=?').get(String(userId),request))return;
    const stat=statSync(path),cacheKey=`${path}:${stat.size}:${stat.mtimeMs}`;
    let attachment=uploads.get(cacheKey);
    if(!attachment){attachment=await ctx.api.uploadFile({source:path,timeout:15000});uploads.set(cacheKey,attachment);}
    const doc=documents.find(d=>d.id===screen.documentId)!;
    const sent=await ctx.api.sendMessageToUser(userId,`${doc.title}\n${doc.description}\nИсточник: ${doc.source_url}`,{attachments:[attachment.toJson()]});
    repo.db.prepare('INSERT OR IGNORE INTO document_deliveries VALUES (?,?,?)').run(String(userId),request,sent.body.mid);
  };
}
