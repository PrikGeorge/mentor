(function(root){
 'use strict';
 let observer=null, main=null, printing=false, printState=[], wide=null;
 function setActive(id){
  if(!main)return;
  main.querySelectorAll('.toc-links a').forEach(link=>{
   const active=link.hash.endsWith('/'+id);
   link.classList.toggle('active',active);
   if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
  });
 }
 function goTo(id){
  const section=document.getElementById(id);if(!section||!main?.contains(section))return;
  for(let el=section;el&&el!==main;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
  const ownDetails=section.querySelector(':scope > details.roadmap-stage');if(ownDetails)ownDetails.open=true;
  const heading=section.querySelector('h2,h3')||section;
  heading.setAttribute('tabindex','-1');
  section.scrollIntoView({block:'start'});
  heading.focus({preventScroll:true});setActive(id);
 }
 function resizeToc(){
  const next=window.innerWidth>1180;
  if(next!==wide){main?.querySelectorAll('.toc-disclosure').forEach(toc=>{toc.open=next});wide=next;}
 }
 function updateExplanationButton(){
  const details=[...main.querySelectorAll('.explanation-details')];
  const expanded=details.length>0&&details.every(item=>item.open);
  main.querySelectorAll('[data-expand-explanations]').forEach(button=>{
   button.textContent=expanded?'Свернуть пояснения':'Развернуть пояснения';
   button.setAttribute('aria-expanded',String(expanded));
  });
 }
 function mount(container){
  observer?.disconnect();main=container;wide=null;resizeToc();
  updateExplanationButton();
  const sections=[...main.querySelectorAll('.doc-section[id]')];
  if(!sections.length)return;
  if('IntersectionObserver' in window){
   observer=new IntersectionObserver(()=>{
    const current=sections.filter(section=>section.getBoundingClientRect().top<=160).at(-1)||sections[0];
    setActive(current.id);
   },{rootMargin:'-10% 0px -65% 0px',threshold:0});
   sections.forEach(section=>observer.observe(section));
  }
  setActive(sections[0].id);
 }
 function expandExplanations(){
  const details=[...main.querySelectorAll('.explanation-details')];
  const open=!details.every(item=>item.open);details.forEach(item=>{item.open=open});
  updateExplanationButton();
 }
 function beforePrint(){
  if(printing)return;printing=true;
  printState=[...document.querySelectorAll('main details')].map(el=>({el,open:el.open}));
  printState.forEach(({el})=>{el.open=true});
 }
 function afterPrint(){
  printState.forEach(({el,open})=>{el.open=open});printState=[];printing=false;
  if(main)updateExplanationButton();
 }
 document.addEventListener('toggle',event=>{if(event.target.matches?.('.explanation-details')&&main)updateExplanationButton()},true);
 window.addEventListener('resize',resizeToc);
 window.addEventListener('beforeprint',beforePrint);
 window.addEventListener('afterprint',afterPrint);
 root.DOCUMENT_NAVIGATION={mount,goTo,expandExplanations};
})(window);
