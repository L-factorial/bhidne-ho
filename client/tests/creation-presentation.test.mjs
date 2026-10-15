import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function presentation(state) {
  const source=readFileSync(new URL('../src/components/CreationCards.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const jsx=(type,props)=>({type,props});
  const dependencies={
    'react/jsx-runtime':{jsx,jsxs:jsx},
    'react':{useEffect(){},useState:()=>[state,()=>{}]},
    'react-native':{View:'View'},
    './ActivityLine':{ActivityLine:'ActivityLine'},
    './SeatReservationNotice':{SeatReservationNotice:'SeatReservationNotice'},
    './AppText':{AppText:'Text'},
    '../theme':{useTheme:()=>({colors:{danger:'red',textMuted:'gray'}})},
    '../i18n/copy':{ui:key=>key},
    '../i18n/useUiLanguage':{useUiLanguage(){}},
    '../multiplayer/playerError':{playerError:error=>String(error)},
    '../multiplayer/creationProgress':{creationProgress:()=>null},
  };
  const module={exports:{}};
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name=>{
    assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];
  },module,module.exports);
  return module.exports;
}
function nodes(tree) {
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(!tree||typeof tree!=='object')return [];
  return [tree,...nodes(tree.props?.children)];
}

test('pending room/table creation never renders a placeholder in the catalog',()=>{
  const state={cards:[{id:'pending',kind:'table',name:'Pending table'},{id:'room',kind:'room',name:'Pending room'}],feedback:[]};
  const {CreationCards}=presentation(state);
  for(const kind of ['room','table']){
    const tree=CreationCards({kind});
    assert.equal(tree,null); // No list item or reserved gap.
    assert.equal(nodes(tree).filter(node=>node.type==='Text'||node.type==='ActivityLine').length,0);
  }
});

test('actionable creation failures remain visible',()=>{
  const {CreationCards}=presentation({cards:[],feedback:[{id:'failure',kind:'table',error:'Request rejected'}]});
  const texts=nodes(CreationCards({kind:'table'})).filter(node=>node.type==='Text');
  assert.equal(texts.length,1);assert.equal(texts[0].props.accessibilityRole,'alert');
  assert.equal(texts[0].props.children,'Request rejected');
});

test('bottom progress is a thin, noninteractive, text-free line',()=>{
  const {CreationActivity}=presentation({cards:[],feedback:[]});
  for(const active of [false,true]){
    const tree=CreationActivity({active});
    assert.equal(tree.props.style.height,3);assert.equal(tree.props.pointerEvents,'none');
    assert.equal(nodes(tree).filter(node=>node.type==='Text').length,0);
    assert.equal(tree.props.children.type,'ActivityLine');assert.equal(tree.props.children.props.active,active);
  }
});
