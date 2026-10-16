import { beforeEach,expect,it,vi } from "vitest";
const mock=vi.hoisted(()=>({authorize:vi.fn(),source:vi.fn(),read:vi.fn(),write:vi.fn(),bucket:vi.fn(),start:vi.fn(),report:vi.fn(),signed:vi.fn()}));
vi.mock("@/integrations/supabase/client.server",()=>({supabaseAdmin:{storage:{getBucket:mock.bucket,from:()=>({createSignedUrl:mock.signed})}}}));
vi.mock("@/lib/specDrawingMatchStore.server",()=>({currentDrawingMatchSource:mock.source,productionDrawingMatchStore:()=>({read:mock.read,write:mock.write})}));
vi.mock("@/lib/specDrawingMatchEngine.server",()=>({loadDrawingMatchReport:mock.report}));
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
const id="88e6dcaa-a120-4f6a-95fa-389820199ef4",key="a".repeat(64);
const actor={staff:true,user:{id:"user"},profile:{role:"Admin",is_active:true},project:{}};
const get=()=>new Request(`https://studio.example/api/spec-drawing-matches?projectId=${id}`);
const post=(expectedKey=key)=>new Request("https://studio.example/api/spec-drawing-matches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:id,expectedKey})});
beforeEach(()=>{vi.clearAllMocks();mock.authorize.mockResolvedValue(actor);mock.source.mockResolvedValue({key,document:{id:"doc",title:"Latest drawings",updated_at:"now",file_url:"not-returned"},items:[{id:"item"}]});mock.bucket.mockResolvedValue({data:{public:false}});mock.report.mockResolvedValue(null);mock.write.mockResolvedValue(true);mock.start.mockResolvedValue({runId:"run"});});
it("rejects an unauthenticated request before reading project or storage data",async()=>{mock.authorize.mockRejectedValue(new ProjectAccessError("Sign in",401));expect((await specDrawingMatchesApi(get())).status).toBe(401);expect(mock.bucket).not.toHaveBeenCalled();expect(mock.source).not.toHaveBeenCalled();});
it("requires both Spec Book and construction-document visibility for a GC",async()=>{mock.authorize.mockResolvedValue({...actor,staff:false,profile:{role:"Contractor",is_active:true},project:{contractor_can_view_spec_book:true,contractor_can_view_construction_docs:false}});expect((await specDrawingMatchesApi(get())).status).toBe(403);expect(mock.source).not.toHaveBeenCalled();});
it("requires staff project access before any paid scan can be claimed",async()=>{mock.authorize.mockImplementation(async(_request,_project,_surface,staffOnly)=>{if(staffOnly)throw new ProjectAccessError("Staff only",403);return actor;});expect((await specDrawingMatchesApi(post())).status).toBe(403);expect(mock.authorize).toHaveBeenCalledWith(expect.any(Request),id,"specBook",true);expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();});
it("refuses a stale source before claiming a new scan",async()=>{expect((await specDrawingMatchesApi(post("b".repeat(64)))).status).toBe(409);expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();});
it("a saved scan claim prevents duplicate background workflows on repeated clicks",async()=>{mock.write.mockResolvedValueOnce(true).mockResolvedValueOnce(false);await specDrawingMatchesApi(post());await specDrawingMatchesApi(post());expect(mock.start).toHaveBeenCalledTimes(1);expect(mock.write).toHaveBeenNthCalledWith(1,`${key}/job.json`,expect.objectContaining({projectId:id,key}),true);});
it("opening unsaved results is read-only and signs no construction PDF",async()=>{const response=await specDrawingMatchesApi(get());const body=await response.json();expect(body.status).toBe("unread");expect(mock.write).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();expect(mock.signed).not.toHaveBeenCalled();expect(response.headers.get("Cache-Control")).toBe("no-store");});
it("refuses a public cache bucket rather than exposing private matches",async()=>{mock.bucket.mockResolvedValue({data:{public:true}});const spy=vi.spyOn(console,"error").mockImplementation(()=>{});expect((await specDrawingMatchesApi(get())).status).toBe(500);spy.mockRestore();expect(mock.source).not.toHaveBeenCalled();});
