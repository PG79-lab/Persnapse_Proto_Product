"use client";
import dynamic from "next/dynamic";
const Workspace = dynamic(() => import("./ui/ContactGraph.jsx"), {
  ssr: false,
  loading: () => (
    <p className="p-8" role="status">
      워크스페이스를 준비하고 있습니다…
    </p>
  ),
});
export function WorkspaceClient() {
  return (
    <div className="integrated-workspace">
      <Workspace mode="server" />
    </div>
  );
}
