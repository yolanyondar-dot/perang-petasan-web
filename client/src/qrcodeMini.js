// Minimal QR Code generator (byte mode, ECC L, versions 1-6). Enough for short URLs.
// Based on common public-domain QR algorithms, compacted for this project.
const EC_L = 1;
const RS_BLOCKS = {
  1:[[1,26,19]],2:[[1,44,34]],3:[[1,70,55]],4:[[1,100,80]],5:[[1,134,108]],6:[[2,86,68]],
};
const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34]};
const G15 = 0x537, G18 = 0x1f25, G15_MASK = 0x5412;
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x=1; for(let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&256) x^=285; } for(let i=255;i<512;i++) EXP[i]=EXP[i-255]; })();
function gfMul(a,b){ return a&&b?EXP[LOG[a]+LOG[b]]:0; }
function polyMul(p,q){ const r=new Uint8Array(p.length+q.length-1); for(let i=0;i<p.length;i++) for(let j=0;j<q.length;j++) r[i+j]^=gfMul(p[i],q[j]); return r; }
function rsGenPoly(n){ let g=new Uint8Array([1]); for(let i=0;i<n;i++){ const p=new Uint8Array([1,EXP[i]]); g=polyMul(g,p); } return g; }
function rsEncode(data,ecLen){ const gen=rsGenPoly(ecLen); const buf=new Uint8Array(data.length+ecLen); buf.set(data,0); for(let i=0;i<data.length;i++){ const coef=buf[i]; if(coef) for(let j=0;j<gen.length;j++) buf[i+j]^=gfMul(gen[j],coef); } return buf.slice(data.length); }
function bitsToBytes(bits){ const bytes=[]; for(let i=0;i<bits.length;i+=8){ let v=0; for(let j=0;j<8;j++) v=(v<<1)|(bits[i+j]||0); bytes.push(v); } return new Uint8Array(bytes); }
function pushBits(arr,val,len){ for(let i=len-1;i>=0;i--) arr.push((val>>>i)&1); }
function encodeData(text,ver){
  const bytes=[]; for(let i=0;i<text.length;i++){ const c=text.charCodeAt(i); bytes.push(c<128?c:63); }
  const cap=[0,17,32,53,78,106,134][ver];
  if(bytes.length>cap) throw new Error('QR text too long');
  const bits=[]; pushBits(bits,4,4); // byte mode
  pushBits(bits,bytes.length,ver<10?8:16);
  for(const b of bytes) pushBits(bits,b,8);
  const total=[0,152,272,440,640,864,1084][ver];
  pushBits(bits,0,Math.min(4,total-bits.length));
  while(bits.length%8) bits.push(0);
  const pad=[0xec,0x11]; let pi=0;
  while(bits.length<total){ pushBits(bits,pad[pi],8); pi^=1; }
  return bitsToBytes(bits);
}
function makeMatrix(ver,dataCodewords){
  const n=ver*4+17; const m=Array.from({length:n},()=>Array(n).fill(null));
  const reserved=Array.from({length:n},()=>Array(n).fill(false));
  function set(x,y,v,r=true){ if(x>=0&&x<n&&y>=0&&y<n){ m[y][x]=v; if(r) reserved[y][x]=true; } }
  function finder(cx,cy){
    for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){ const x=cx+dx,y=cy+dy; if(x<0||x>=n||y<0||y>=n) continue;
      const adx=Math.abs(dx),ady=Math.abs(dy); const v=(adx===4||ady===4)?0:(adx===3||ady===3||(adx<=1&&ady<=1))?1:0; set(x,y,v); }
  }
  finder(3,3); finder(n-4,3); finder(3,n-4);
  for(let i=0;i<n;i++){ if(!reserved[6][i]) set(i,6,i%2===0?1:0); if(!reserved[i][6]) set(6,i,i%2===0?1:0); }
  set(8,n-8,1);
  const aligns=ALIGN[ver];
  for(const ay of aligns) for(const ax of aligns){
    if((ax<8&&ay<8)||(ax>n-9&&ay<8)||(ax<8&&ay>n-9)) continue;
    for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){ const adx=Math.abs(dx),ady=Math.abs(dy); set(ax+dx,ay+dy,(adx===2||ady===2||(!adx&&!ady))?1:0); }
  }
  for(let i=0;i<8;i++){ if(!reserved[8][i]) set(i,8,0); if(!reserved[8][n-1-i]) set(n-1-i,8,0); if(!reserved[i][8]) set(8,i,0); if(!reserved[n-1-i][8]) set(8,n-1-i,0); }
  // format info (mask 0, ECC L=01)
  const fmtBits=bchFormat(EC_L<<3|0); // mask 0
  const fmtPos=[[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],[8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0]];
  const fmtPos2=[[8,n-1],[8,n-2],[8,n-3],[8,n-4],[8,n-5],[8,n-6],[8,n-7],[n-8,8],[n-7,8],[n-6,8],[n-5,8],[n-4,8],[n-3,8],[n-2,8],[n-1,8]];
  for(let i=0;i<15;i++){ const v=(fmtBits>>(14-i))&1; set(fmtPos[i][0],fmtPos[i][1],v); set(fmtPos2[i][0],fmtPos2[i][1],v); }

  // place data
  let bitIdx=0; const totalBits=dataCodewords.length*8;
  let dir=-1;
  for(let x=n-1;x>0;x-=2){ if(x===6) x--; for(let i=0;i<n;i++){ const y=dir===-1?n-1-i:i;
      for(const dx of [0,-1]){ const xx=x+dx; if(reserved[y][xx]) continue;
        let v=0; if(bitIdx<totalBits) v=(dataCodewords[bitIdx>>3]>>(7-(bitIdx&7)))&1;
        // mask 0: (r+c)%2==0
        if(((y+xx)%2)===0) v^=1;
        set(xx,y,v,false); bitIdx++;
      }
    } dir=-dir;
  }
  return { m, n };
}
function bchFormat(data){
  let d=data<<10;
  while(bchDegree(d)>=bchDegree(G15)) d^=(G15<<(bchDegree(d)-bchDegree(G15)));
  return ((data<<10)|d)^G15_MASK;
}
function bchDegree(v){ let d=0; while(v){ d++; v>>>=1; } return d-1; }

export function makeQR(text) {
  const bytes = unescape(encodeURIComponent(text));
  let ver=1; while(ver<6 && bytes.length>[0,17,32,53,78,106,134][ver]) ver++;
  const data=encodeData(text,ver);
  const [blocks]=[RS_BLOCKS[ver]];
  const block=blocks[0];
  const dataPer=block[1]-block[2];
  const dataBlocks=[], ecBlocks=[];
  let off=0;
  for(let i=0;i<block[0];i++){ const d=data.slice(off,off+dataPer); dataBlocks.push(d); ecBlocks.push(rsEncode(d,block[2])); off+=dataPer; }
  const result=[];
  const maxData=Math.max(...dataBlocks.map(b=>b.length));
  for(let i=0;i<maxData;i++) for(const b of dataBlocks) if(i<b.length) result.push(b[i]);
  const maxEc=Math.max(...ecBlocks.map(b=>b.length));
  for(let i=0;i<maxEc;i++) for(const b of ecBlocks) if(i<b.length) result.push(b[i]);
  return makeMatrix(ver,new Uint8Array(result));
}

export function drawQRToCanvas(canvas, text, opts={}) {
  const size = opts.size || canvas.width || 120;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,size,size);
  let qr;
  try { qr = makeQR(text || ' '); } catch(e) {
    ctx.fillStyle = '#000'; ctx.font='12px sans-serif'; ctx.fillText('QR',10,20); return;
  }
  const n=qr.n; const cell=Math.floor(size/(n+2)); const pad=Math.floor((size-cell*n)/2);
  ctx.fillStyle = '#111827';
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(qr.m[y][x]===1) ctx.fillRect(pad+x*cell,pad+y*cell,cell,cell);
}
