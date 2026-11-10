import { beforeEach,expect,it,vi } from "vitest";
const mock=vi.hoisted(()=>({authorize:vi.fn(),source:vi.fn(),read:vi.fn(),write:vi.fn(),bucket:vi.fn(),start:vi.fn(),report:vi.fn(),signed:vi.fn(),apply:vi.fn(),budget:vi.fn()}));
vi.mock("@/integrations/supabase/client.server",()=>({supabaseAdmin:{storage:{getBucket:mock.bucket,from:()=>({createSignedUrl:mock.signed})}}}));
vi.mock("@/lib/specDrawingMatchStore.server",()=>({currentDrawingMatchSource:mock.source,productionDrawingMatchStore:()=>({read:mock.read,write:mock.write}),quantityDrawingKey:(value:string)=>value === "legacy" ? "c".repeat(64) : "b".repeat(64)}));
vi.mock("@/lib/specDrawingMatchEngine.server",()=>({loadDrawingMatchReport:mock.report}));
vi.mock("@/lib/specQuantityApproval.server",()=>({applyDrawingQuantities:mock.apply}));
vi.mock("@/lib/fullSpecBudget.server",()=>({assertProductionFullSpecBudget:mock.budget}));
vi.mock("workflow/api",()=>({start:mock.start}));
vi.mock("@/workflows/specDrawingMatches",()=>({specDrawingMatchesWorkflow:vi.fn()}));
vi.mock("@/lib/measuredAccess.server",async()=>{const actual=await vi.importActual<any>("@/lib/measuredAccess.server");return {...actual,requireProjectAccess:mock.authorize};});
import {specDrawingMatchesApi} from "@/lib/specDrawingMatches.server";
import {ProjectAccessError} from "@/lib/measuredAccess.server";
it("creates only direct-PDF jobs from the production API", async () => {
  await specDrawingMatchesApi(post());
  expect(mock.write).toHaveBeenCalledWith(`${key}/job.json`, expect.objectContaining({mode: "direct"}), true);
});
it("refuses an attempt to enable AI through the request body", async () => {
  const request = new Request("https://studio.example/api/spec-drawing-matches", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({projectId: id, expectedKey: key, mode: "ai"}),
  });
  const response = await specDrawingMatchesApi(request);
  expect(response.status).toBe(400);
  expect(mock.write).not.toHaveBeenCalled();
  expect(mock.start).not.toHaveBeenCalled();
});
it("starts a separate staff-only quantity scan against the current source and avoids duplicate jobs", async () => {
  const quantityKey = "b".repeat(64);
  const request = () => new Request("https://studio.example/api/spec-drawing-matches", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: id, expectedKey: quantityKey, purpose: "quantities", full_check_run_id:runId }) });
  mock.write.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await specDrawingMatchesApi(request())).status).toBe(200);
  expect((await specDrawingMatchesApi(request())).status).toBe(200);
  expect(mock.source).toHaveBeenCalledWith(id, "quantities");
  expect(mock.write).toHaveBeenCalledWith(`${quantityKey}/job.json`, expect.objectContaining({ mode: "ai", purpose: "quantities" }), true);
  expect(mock.start).toHaveBeenCalledTimes(1);
});
const id="88e6dcaa-a120-4f6a-95fa-389820199ef4",key="a".repeat(64),runId="11111111-1111-4111-8111-111111111111";
const actor={staff:true,user:{id:"user",email:"ken@meravinteriors.com"},profile:{role:"Admin",email:"ken@meravinteriors.com",is_active:true},project:{}};
const get=()=>new Request(`https://studio.example/api/spec-drawing-matches?projectId=${id}`);
const post=(expectedKey=key)=>new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,expectedKey})});
beforeEach(()=>{vi.clearAllMocks();mock.authorize.mockResolvedValue(actor);mock.source.mockResolvedValue({key,document:{id:"doc",title:"Latest drawings",updated_at:"now",file_url:"not-returned"},items:[{id:"item"}]});mock.bucket.mockResolvedValue({data:{public:false}});mock.report.mockResolvedValue(null);mock.write.mockResolvedValue(true);mock.start.mockResolvedValue({runId:"run"});mock.budget.mockResolvedValue({});});
it("requires a server-verified active budget before starting a paid quantity scan",async()=>{
  const request=(full_check_run_id?:string)=>new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,purpose:"quantities",expectedKey:"b".repeat(64),...(full_check_run_id?{full_check_run_id}:{})})});
  expect((await specDrawingMatchesApi(request())).status).toBe(400);expect(mock.start).not.toHaveBeenCalled();
  mock.budget.mockRejectedValue(new Error("no active run"));expect((await specDrawingMatchesApi(request(runId))).status).toBe(409);expect(mock.start).not.toHaveBeenCalled();
});
it("rejects an unauthenticated request before reading project or storage data",async()=>{mock.authorize.mockRejectedValue(new ProjectAccessError("Sign in",401));expect((await specDrawingMatchesApi(get())).status).toBe(401);expect(mock.bucket).not.toHaveBeenCalled();expect(mock.source).not.toHaveBeenCalled();});
it("requires both Spec Book and construction-document visibility for a GC",async()=>{mock.authorize.mockResolvedValue({...actor,staff:false,profile:{role:"Contractor",is_active:true},project:{contractor_can_view_spec_book:true,contractor_can_view_construction_docs:false}});expect((await specDrawingMatchesApi(get())).status).toBe(403);expect(mock.source).not.toHaveBeenCalled();});
it("requires staff project access before any paid scan can be claimed",async()=>{mock.authorize.mockImplementation(async(_request,_project,_surface,staffOnly)=>{if(staffOnly)throw new ProjectAccessError("Staff only",403);return actor;});expect((await specDrawingMatchesApi(post())).status).toBe(403);expect(mock.authorize).toHaveBeenCalledWith(expect.any(Request),id,"specBook",true);expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();});
it("keeps quantity-check results restricted to staff",async()=>{mock.authorize.mockImplementation(async(_request,_project,_surface,staffOnly)=>{if(staffOnly)throw new ProjectAccessError("Staff only",403);return actor;});const response=await specDrawingMatchesApi(new Request(`https://studio.example/api/spec-drawing-matches?projectId=${id}&purpose=quantities`));expect(response.status).toBe(403);expect(mock.source).not.toHaveBeenCalled();});
it("limits starting paid quantity scans to Ken's authenticated account while allowing staff to read reports",async()=>{
  const other={...actor,user:{...actor.user,email:"other@meravinteriors.com"},profile:{...actor.profile,email:"other@meravinteriors.com"}};
  mock.authorize.mockResolvedValue(other);
  const read=await specDrawingMatchesApi(new Request(`https://studio.example/api/spec-drawing-matches?projectId=${id}&purpose=quantities`));
  expect(read.status).toBe(200);expect((await read.json()).canScan).toBe(false);
  const response=await specDrawingMatchesApi(new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,purpose:"quantities",expectedKey:"b".repeat(64)})}));
  expect(response.status).toBe(403);expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();
});
it("does not trust a Ken profile attached to a different authenticated user",async()=>{
  mock.authorize.mockResolvedValue({...actor,user:{...actor.user,email:"other@meravinteriors.com"}});
  const response=await specDrawingMatchesApi(new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,purpose:"quantities",expectedKey:"b".repeat(64)})}));
  expect(response.status).toBe(403);expect(mock.start).not.toHaveBeenCalled();
});
it("allows other authorized staff to approve previously saved quantity findings without starting paid work",async()=>{
  mock.authorize.mockResolvedValue({...actor,user:{...actor.user,email:"other@meravinteriors.com"},profile:{...actor.profile,email:"other@meravinteriors.com"}});
  mock.apply.mockResolvedValue({results:[]});
  const response=await specDrawingMatchesApi(new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,purpose:"quantities",action:"apply",expectedKey:"b".repeat(64),itemIds:[id]})}));
  expect(response.status).toBe(200);expect(mock.apply).toHaveBeenCalledOnce();expect(mock.start).not.toHaveBeenCalled();
});
it("requires staff access to approve quantities and never starts a scan",async()=>{mock.authorize.mockRejectedValue(new ProjectAccessError("Staff only",403));const response=await specDrawingMatchesApi(new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,purpose:"quantities",action:"apply",expectedKey:"b".repeat(64),itemIds:[id]})}));expect(response.status).toBe(403);expect(mock.start).not.toHaveBeenCalled();});
it("keeps older saved quantity reports visible but requires a new scan before approval",async()=>{mock.source.mockResolvedValue({key,legacyKey:"legacy",document:{id:"doc",title:"Latest drawings",updated_at:"now",file_url:"private"},items:[{id:"item"}]});mock.report.mockResolvedValueOnce(null).mockResolvedValueOnce({key:"c".repeat(64),status:"partial",matches:[]});const response=await specDrawingMatchesApi(new Request(`https://studio.example/api/spec-drawing-matches?projectId=${id}&purpose=quantities`));const body=await response.json();expect(body.needsFreshScan).toBe(true);expect(body.freshKey).toBe("b".repeat(64));expect(mock.start).not.toHaveBeenCalled();});
it("refuses a stale source before claiming a new scan",async()=>{expect((await specDrawingMatchesApi(post("b".repeat(64)))).status).toBe(409);expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();});
it("a saved scan claim prevents duplicate background workflows on repeated clicks",async()=>{mock.write.mockResolvedValueOnce(true).mockResolvedValueOnce(false);await specDrawingMatchesApi(post());await specDrawingMatchesApi(post());expect(mock.start).toHaveBeenCalledTimes(1);expect(mock.write).toHaveBeenNthCalledWith(1,`${key}/job.json`,expect.objectContaining({projectId:id,key}),true);});
it("opening unsaved results is read-only and signs no construction PDF",async()=>{const response=await specDrawingMatchesApi(get());const body=await response.json();expect(body.status).toBe("unread");expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();expect(mock.signed).not.toHaveBeenCalled();expect(response.headers.get("Cache-Control")).toBe("no-store");});
it("refuses a public cache bucket rather than exposing private matches",async()=>{mock.bucket.mockResolvedValue({data:{public:true}});const spy=vi.spyOn(console,"error").mockImplementation(()=>{});expect((await specDrawingMatchesApi(get())).status).toBe(500);spy.mockRestore();expect(mock.source).not.toHaveBeenCalled();});
