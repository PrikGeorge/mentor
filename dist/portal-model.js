(function(root){
 'use strict';
 const teacherPages=new Set(['plan','guide','materials','answers','run','verification','collections','streams','core','course','map-practice','code','practice','review']);
 const studentPages=new Set(['tasks','materials','homework','code','practice','review']);
 const profilePages=new Set(['profile','roadmap','projects','review','career','journal','goal','lessons']);
 const learnerPages=new Set(['goal','lessons','roadmap','review']);
 function studentHref(id,page,detail){return '#students/'+encodeURIComponent(id)+(page?'/'+page:'')+(detail?'/'+encodeURIComponent(detail):'');}
 function lessonHref(sid,lid,audience,page,detail){return studentHref(sid)+'/lessons/'+encodeURIComponent(lid)+(audience?'/'+audience:'')+(page?'/'+page:'')+(detail?'/'+encodeURIComponent(detail):'');}
 function hasPreparedBundle(lesson){return lesson?.studentId==='michael'&&lesson.bundleId==='library-2026-09-27';}
 function lessonFocus(lessons,now=new Date()){
  const timed=lessons.map(lesson=>({lesson,start:new Date(lesson.date+'T'+lesson.time+':00+03:00').getTime()})).filter(item=>Number.isFinite(item.start)).sort((a,b)=>a.start-b.start);
  const instant=now.getTime(),next=timed.find(item=>item.start+Number(item.lesson.duration)*60000>=instant);
  if(next)return {lesson:next.lesson,upcoming:true};
  const latest=timed[timed.length-1];return latest?{lesson:latest.lesson,upcoming:false}:null;
 }
 function parseRoute(hash,state){
  let p;try{p=decodeURIComponent((hash||'').replace(/^#/, '')).split('/').filter(Boolean)}catch{return {kind:'missing'}}
  if(!p.length||(p[0]==='students'&&p.length===1))return {kind:'students'};
  if(p[0]!=='students')return {kind:'missing'};
  const student=state.students.find(s=>s.id===p[1]);if(!student)return {kind:'missing'};
  if(p.length===2)return {kind:'student',student};
  if(profilePages.has(p[2])&&(p.length===3||(p.length===4&&/^section-\d+$/.test(p[3]))))return {kind:'profile',student,page:p[2],detail:p[3]||null};
  if(p[2]!=='lessons')return {kind:'missing'};
  const lesson=state.lessons.find(l=>l.id===p[3]&&l.studentId===student.id);if(!lesson)return {kind:'missing'};
  const audience=p[4]||null,page=p[5]||(audience==='teacher'?'guide':audience==='student'?'tasks':'overview'),detail=p[6]||null;
  if(p.length>7||(!audience&&p.length>4))return {kind:'missing'};
  if(audience&&!['teacher','student'].includes(audience))return {kind:'missing'};
  if(audience&&!(audience==='teacher'?teacherPages:studentPages).has(page))return {kind:'missing'};
  if(page==='code'&&!(audience==='student'?['ListTask','GroupingTask']:['ListTask','GroupingTask','ListSolutions','GroupingSolution']).includes(detail))return {kind:'missing'};
  if(page==='practice'&&detail&&!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(detail))return {kind:'missing'};
  if(detail&&!['code','practice'].includes(page)&&!/^section-\d+$/.test(detail))return {kind:'missing'};
  return {kind:'lesson',student,lesson,audience,page,detail};
 }
 function isStudentRoute(route){return route.kind==='student'||(route.kind==='profile'&&learnerPages.has(route.page))||(route.kind==='lesson'&&route.audience==='student');}
 const api={studentHref,lessonHref,hasPreparedBundle,lessonFocus,parseRoute,isStudentRoute};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MentorRoutes=api;
})(typeof window!=='undefined'?window:globalThis);
