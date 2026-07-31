import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { clearAccountPreviewsForTests, consumeAccountPreview, createAccountPreview } from "@/lib/account-preview-store";

describe("account preview references",()=>{
  beforeEach(()=>clearAccountPreviewsForTests());
  it("accepts once for the same actor",()=>{const p=createAccountPreview("actor","synthetic,csv",100);expect(consumeAccountPreview("actor",p.id,p.integrity,101)).toEqual({ok:true,csv:"synthetic,csv"});expect(consumeAccountPreview("actor",p.id,p.integrity,102)).toEqual({ok:false,reason:"preview_missing_or_expired"});});
  it("rejects tampering without consuming the valid preview",()=>{const p=createAccountPreview("actor","synthetic,csv",100);expect(consumeAccountPreview("actor",p.id,"00",101).reason).toBe("preview_tampered");expect(consumeAccountPreview("actor",p.id,p.integrity,102).ok).toBe(true);});
  it("rejects the wrong actor and expiry",()=>{const p=createAccountPreview("actor","synthetic,csv",100);expect(consumeAccountPreview("other",p.id,p.integrity,101).ok).toBe(false);expect(consumeAccountPreview("actor",p.id,p.integrity,100+10*60*1000).reason).toBe("preview_missing_or_expired");});
});
