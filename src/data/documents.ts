import { SOURCES } from './sources.js';
export interface DocumentTemplate { id:string; title:string; taskIds:string[]; source_url:string; verified_at:string; description:string; fileName?:string }
// Only administrator-approved filenames; users and the model cannot select filesystem paths.
export const documents:DocumentTemplate[]=[
 {id:'r11001',title:'Заявление Р11001',taskIds:['reg-8'],fileName:'R11001.pdf',source_url:'https://service.nalog.ru/gosreg/intro.html?sfrd=11001',verified_at:'2026-09-30',description:'Перед подачей проверьте редакцию формы и заполненные данные по официальному сервису ФНС.'},
 {id:'charter',title:'Типовой устав ООО',taskIds:['reg-5'],source_url:'https://service.nalog.ru/statute/',verified_at:'2026-09-30',description:'Подберите подходящий типовой устав в официальном сервисе ФНС. Один вариант не подходит всем организациям.'},
 {id:'founder-decision',title:'Решение единственного учредителя',taskIds:['reg-6'],fileName:'Решение единственного учредителя (1).docx',source_url:SOURCES.registration,verified_at:'2026-09-30',description:'Для одного учредителя. Загруженный образец нужно проверить и адаптировать к своей ситуации.'},
 {id:'founders-minutes',title:'Протокол собрания учредителей',taskIds:['reg-6'],fileName:'Протокол общего собрания учредителей ООО — шаблон.docx',source_url:SOURCES.registration,verified_at:'2026-09-30',description:'Для нескольких учредителей. Это образец для подготовки, а не подтверждение юридической корректности заполненного документа.'},
];
