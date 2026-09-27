"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export function InterviewQrCamera({ onCode }: { onCode: (value: string) => void }) {
  const video=useRef<HTMLVideoElement>(null);
  const stream=useRef<MediaStream | null>(null);
  const alive=useRef(true);
  const [running,setRunning]=useState(false);
  const [starting,setStarting]=useState(false);
  const [error,setError]=useState("");
  const [manual,setManual]=useState("");
  function stop() { stream.current?.getTracks().forEach(t=>t.stop()); stream.current=null; setRunning(false); }
  useEffect(()=>{ alive.current=true; return ()=>{alive.current=false;stream.current?.getTracks().forEach(t=>t.stop());}; },[]);
  useEffect(()=>{
    if (!running) return;
    const canvas=document.createElement("canvas");
    let frame=0;
    function tick() {
      const v=video.current;
      if (v && v.readyState>=2 && v.videoWidth) {
        canvas.width=640; canvas.height=Math.round(640*v.videoHeight/v.videoWidth);
        const ctx=canvas.getContext("2d",{willReadFrequently:true});
        if (ctx) {
          ctx.drawImage(v,0,0,canvas.width,canvas.height);
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
          const found=jsQR(pixels.data,pixels.width,pixels.height);
          if (found) { stop(); onCode(found.data); return; }
        }
      }
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[running,onCode]);
  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      if (!alive.current) {media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;
      if(video.current) {video.current.srcObject=media;await video.current.play();}
      setRunning(true);
    } catch {stop();setError("Không mở được camera. Cho phép camera trong trình duyệt hoặc tìm theo số điện thoại.");}
    finally {if(alive.current)setStarting(false);}
  }
  return <div className="grid gap-2 rounded-lg border p-3">
    <video ref={video} muted playsInline className={running ? "w-full max-w-md rounded-md" : "hidden"} />
    <button type="button" disabled={starting} className="rounded-md border px-3 py-2" onClick={()=>running ? stop() : void start()}>{starting ? "Đang mở camera…" : running ? "Dừng camera" : "Quét QR bằng camera"}</button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <form className="flex gap-2" onSubmit={e=>{e.preventDefault();onCode(manual);}}>
      <input aria-label="Mã QR từ máy quét" className="min-w-0 flex-1 rounded border p-2" value={manual} onChange={e=>setManual(e.target.value)} placeholder="Dán mã từ máy quét (nếu có)" />
      <button className="rounded border px-3" type="submit">Tra vé</button>
    </form>
  </div>;
}
