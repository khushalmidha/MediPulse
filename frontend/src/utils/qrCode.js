/* eslint-disable react/prop-types */
import React from "react";
import qrcode from "qrcode-generator";

// Use the encoder's documented byte hook so strings are encoded as UTF-8.
qrcode.stringToBytes = text => Array.from(new TextEncoder().encode(text));
export function generateQrMatrix(value) {
  const text=String(value ?? "");
  if(new TextEncoder().encode(text).length>1024) throw new Error("QR payload is too long");
  const qr=qrcode(0,"M");qr.addData(text,"Byte");qr.make();
  const count=qr.getModuleCount();
  return Array.from({length:count},(_,row)=>Array.from({length:count},(_,col)=>qr.isDark(row,col)));
}
const dimension=value=>Number.isFinite(value) && value>0 && value<=4096?value:180;
export function generateQrSvgString(value,size=180) {
  const matrix=generateQrMatrix(value), padding=4, total=matrix.length+padding*2;
  const rects=matrix.flatMap((row,r)=>row.flatMap((dark,c)=>dark?[`<rect x="${c+padding}" y="${r+padding}" width="1" height="1" fill="#0f172a"/>`]:[])).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR Code for visit ticket" viewBox="0 0 ${total} ${total}" width="${dimension(size)}" height="${dimension(size)}"><rect width="${total}" height="${total}" fill="#ffffff"/>${rects}</svg>`;
}
export function QrCodeSvg({value,size=180,className="",style={}}) {
  const matrix=generateQrMatrix(value),padding=4,total=matrix.length+padding*2;
  const rects=matrix.flatMap((row,r)=>row.flatMap((dark,c)=>dark?[React.createElement("rect",{key:`${r}-${c}`,x:c+padding,y:r+padding,width:1,height:1,fill:"#0f172a"})]:[]));
  return React.createElement("svg",{xmlns:"http://www.w3.org/2000/svg",role:"img","aria-label":"QR Code for visit ticket",viewBox:`0 0 ${total} ${total}`,width:dimension(size),height:dimension(size),className,style:{display:"block",shapeRendering:"crispEdges",...style}},React.createElement("rect",{width:total,height:total,fill:"#ffffff"}),...rects);
}
export default QrCodeSvg;
