const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{createRequire}=require('node:module'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const deps=process.env.TEST_REACT_TOOLS?createRequire(path.join(process.env.TEST_REACT_TOOLS,'package.json')):require;
const React=deps('react'),{act,create}=deps('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
const flatten=s=>Array.isArray(s)?Object.assign({},...s.filter(Boolean).map(flatten)):s;
const moduleObject={exports:{}};
const code=ts.transpileModule(readFileSync(path.resolve(__dirname,'../src/components/AppText.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(n=>n==='react-native'?{Text:'NativeText',StyleSheet:{flatten}}:n==='../theme'?{fonts:{display:'SerifBold',editorial:'SerifBold',body:'Inter',medium:'InterMedium'},useTheme:()=>({colors:{text:'#111111'}})}:deps(n),moduleObject,moduleObject.exports);
const {AppText}=moduleObject.exports;
test('shared typography enlarges labels, uses serif headings and preserves inline inheritance and scaling',async()=>{
 let r;await act(async()=>{r=create(React.createElement(React.Fragment,null,
  React.createElement(AppText,{accessibilityRole:'header',style:{fontSize:18}},'Heading'),
  React.createElement(AppText,{style:{fontSize:11,lineHeight:15,color:'#555555'}},'Label'),
  React.createElement(AppText,{style:{fontSize:20}},'Body ',React.createElement(AppText,{style:{fontStyle:'italic'}},'inline'))));});
 const nodes=r.root.findAllByType('NativeText'),styles=nodes.map(n=>flatten(n.props.style));
 assert.equal(styles[0].fontFamily,'SerifBold');assert.equal(styles[0].fontSize,22);
 assert.equal(styles[1].fontSize,14);assert.equal(styles[1].lineHeight,20);assert.equal(styles[1].color,'#555555');
 assert.equal(styles[2].fontSize,20);assert.deepEqual(styles[3],{fontStyle:'italic'});
 assert.ok(nodes.every(n=>n.props.allowFontScaling!==false&&n.props.maxFontSizeMultiplier===undefined));
 await act(async()=>r.unmount());
});

test('button labels retain modern medium font rather than becoming serif headings',async()=>{
 let r;await act(async()=>{r=create(React.createElement(AppText,{style:{fontFamily:'InterMedium',fontSize:12}},'Join'));});
 const style=flatten(r.root.findByType('NativeText').props.style);assert.equal(style.fontFamily,'InterMedium');assert.equal(style.fontSize,14);
 await act(async()=>r.unmount());
});
