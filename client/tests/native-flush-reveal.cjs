// Exercise actual card components with controllable native layout callbacks.
const test=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{createRequire}=require('node:module'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const deps=process.env.TEST_REACT_TOOLS?createRequire(path.join(process.env.TEST_REACT_TOOLS,'package.json')):require;
const React=deps('react'),{act,create}=deps('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
const targets=[];
const native={View:'View',Pressable:'Pressable',StyleSheet:{absoluteFill:{}},AccessibilityInfo:{isReduceMotionEnabled:async()=>false,addEventListener:()=>({remove(){}})},Animated:{View:'AnimatedView',Value:class{interpolate(){return {}; }},timing:(_value,options)=>({start(){targets.push(options.toValue);},stop(){}})}};
function load(file){const module={exports:{}};const source=ts.transpileModule(readFileSync(path.resolve(__dirname,'../src',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const imports=name=>name==='react-native'?native:name.startsWith('react')?deps(name):name==='../multiplayer/flush'?load('multiplayer/flush.ts'):name==='./CompactCardFace'?{CompactCardFace:'CardFace'}:name==='./AppText'?{AppText:'Text'}:name==='./CardBack'?{CardBack:'CardBack'}:name==='../theme'?{useTheme:()=>({colors:{}})}:name==='../i18n/copy.ts'?{ui:key=>key}:name==='../i18n/useUiLanguage'?{useUiLanguage(){}}:require(name);
vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(imports,module,module.exports);return module.exports;}
const {FlushCards}=load('components/FlushCards.tsx');
test('native reveal waits for all server cards and face layout before flipping',async()=>{
 let renderer;targets.length=0;
 await act(async()=>{renderer=create(React.createElement(FlushCards,{cards:[],tapToToggle:true,shown:true}));});
 try{
  assert.ok(targets.every(v=>v===0));targets.length=0;
  await act(async()=>renderer.update(React.createElement(FlushCards,{cards:['AS','7H','9C'],tapToToggle:true,shown:true})));
  assert.equal(renderer.root.findAllByType('CardFace').length,3);assert.ok(targets.every(v=>v===0));
  const layouts=renderer.root.findAllByType('View').filter(n=>n.props.onLayout);assert.equal(layouts.length,3);
  await act(async()=>{for(const node of layouts)node.props.onLayout();});assert.equal(targets.filter(v=>v===1).length,3);
  targets.length=0;
  await act(async()=>renderer.update(React.createElement(FlushCards,{cards:[],tapToToggle:true,shown:true})));
  assert.equal(renderer.root.findAllByType('CardFace').length,0);assert.ok(targets.every(v=>v===0));
 }finally{await act(async()=>renderer.unmount());}
});
