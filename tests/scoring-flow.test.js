import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as pose from '../src/pose.js';
import * as camera from '../src/camera.js';
test('camera inference results update the displayed score without baseline or hips',()=>{
  const nodes=new Map();
  const context2d=new Proxy({}, {get:()=>()=>{}});
  function element(){return {textContent:'',value:10,hidden:false,checked:true,disabled:false,style:{},children:[],append(...items){this.children.push(...items);},before(){},replaceChildren(){this.children=[];},querySelector(){return element();},getContext(){return context2d;}};}
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,addEventListener(){}};
  const context=vm.createContext({...pose,...camera,document,localStorage:{getItem:()=>null,setItem(){}},window:{addEventListener(){}},setTimeout,clearTimeout,console});
  const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(source,context);
  const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0}));
  Object.assign(points[11],{x:.3,y:.4,visibility:1});Object.assign(points[12],{x:.7,y:.4,visibility:1});
  context.points=points;
  vm.runInContext(`video.videoWidth=640;video.videoHeight=480;session={start:0,sum:0,samples:0,counts:{},buckets:[]};processPose(points,100);`,context);
  assert.equal(nodes.get('score').textContent,100);
  assert.match(nodes.get('scoreDesc').textContent,/일반/);
  assert.match(nodes.get('status').textContent,/1\/4/);
  points[11].y=.55;
  vm.runInContext('processPose(points,200);',context);
  assert.ok(nodes.get('score').textContent<100);
  assert.equal(vm.runInContext('session.samples',context),2);
});
