const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(stage=false){
 const events={},details={tagName:'DETAILS',open:false},other={tagName:'DETAILS',open:true};
 const heading={setAttribute(){},focus(){this.focused=true}};
 const section={id:'section-3',tagName:'SECTION',scrollIntoView(){this.scrolled=true},querySelector(selector){
  if(selector==='h2,h3')return heading;
  if(selector===':scope > details'||selector===':scope > details.roadmap-stage'&&stage)return details;
  return null;
 }};
 const main={contains:el=>el===section,querySelectorAll:selector=>selector==='.doc-section[id]'?[section]:[]};
 section.parentElement=main;
 const document={getElementById:id=>id===section.id?section:null,querySelectorAll:()=>[details,other],addEventListener(){}};
 const window={innerWidth:1280,addEventListener:(name,fn)=>{events[name]=fn}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/document-navigation.js'),'utf8'),{window,document});
 window.DOCUMENT_NAVIGATION.mount(main);
 return {nav:window.DOCUMENT_NAVIGATION,events,details,other,heading,section};
}
test('following a guide anchor preserves independently collapsed explanations',()=>{
 const f=fixture();f.nav.goTo('section-3');
 assert.equal(f.details.open,false);
 assert.equal(f.heading.focused,true);
 assert.equal(f.section.scrolled,true);
});
test('following a roadmap anchor opens its stage and focuses its heading',()=>{
 const f=fixture(true);f.nav.goTo('section-3');
 assert.equal(f.details.open,true);assert.equal(f.heading.focused,true);
});
test('printing expands all document details then restores their individual states',()=>{
 const f=fixture();f.events.beforeprint();f.events.beforeprint();
 assert.equal(f.details.open,true);assert.equal(f.other.open,true);
 f.events.afterprint();
 assert.equal(f.details.open,false);assert.equal(f.other.open,true);
});
