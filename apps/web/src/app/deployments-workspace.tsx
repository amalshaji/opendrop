import { AlertCircle, ArrowUpRight, Eye, EyeOff, Loader2, PackageOpen, Plus, Route } from "lucide-react";
import { formatBytes, relativeTime } from "@/app/format";
import type { DeploymentsState } from "@/app/use-deployments-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DeploymentsWorkspaceProps {
  state: DeploymentsState;
  loadDeployments: () => void | Promise<void>;
  onCreateDrop: () => void;
}

export function DeploymentsWorkspace({ state, loadDeployments, onCreateDrop }: DeploymentsWorkspaceProps) {
  const isPending = state.status === "idle" || state.status === "loading";
  return (
    <Card className="deploymentsPanel">
      <CardHeader>
        <div>
          <CardTitle>Published drops</CardTitle>
          <CardDescription>
            {isPending
              ? "Loading deployment routes"
              : `${state.deployments.length} ${state.deployments.length === 1 ? "deployment route" : "deployment routes"} · newest activity first`}
          </CardDescription>
        </div>
        <CardAction>
          <Button type="button" onClick={onCreateDrop}>
            <Plus size={16} /> New drop
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="deploymentsPanelContent px-0">
        <DeploymentsContent state={state} loadDeployments={loadDeployments} onCreateDrop={onCreateDrop} />
      </CardContent>
    </Card>
  );
}

function DeploymentsContent({ state, loadDeployments, onCreateDrop }: DeploymentsWorkspaceProps) {
  switch (state.status) {
    case "idle":
    case "loading":
      return (
        <div className="publishedState" aria-live="polite">
          <Loader2 className="animate-spin" size={18} />
          <strong>Loading published drops</strong>
          <span>Reading your latest deployment routes and versions.</span>
        </div>
      );
    case "error":
      return (
        <div className="publishedState publishedStateError" role="alert">
          <AlertCircle size={18} />
          <strong>Published drops could not be loaded</strong>
          <span>{state.error}</span>
          <Button type="button" variant="outline" onClick={loadDeployments}>Try again</Button>
        </div>
      );
    case "ready":
      if (state.deployments.length === 0) {
        return (
          <div className="publishedState">
            <PackageOpen size={20} />
            <strong>No published drops yet</strong>
            <span>Publish a folder or zip and its route will appear here.</span>
            <Button type="button" variant="outline" onClick={onCreateDrop}>
              <Plus size={16} /> Create your first drop
            </Button>
          </div>
        );
      }
      return (
        <div className="publishedLedger" role="table" aria-label="Published drops">
          <div className="publishedLedgerHeader" role="row">
            <span role="columnheader">Drop</span>
            <span role="columnheader">Access</span>
            <span role="columnheader">Latest</span>
            <span role="columnheader">Updated</span>
            <span aria-hidden="true" />
          </div>
          {state.deployments.map(({ family, version }) => {
            const route = `/${family.namespaceName}/${family.slug}`;
            const isPublic = family.visibility === "public";
            return (
              <div className="publishedRow" role="row" key={family.id}>
                <div className="publishedIdentity" role="cell">
                  <span className="publishedRouteIcon" aria-hidden="true"><Route size={15} /></span>
                  <div>
                    <a className="publishedRoute" href={route}>{route}</a>
                    <span>{version.fileCount} {version.fileCount === 1 ? "file" : "files"} · {formatBytes(version.totalBytes)}</span>
                  </div>
                </div>
                <Badge className={`publishedAccess ${isPublic ? "isPublic" : "isPrivate"}`} variant="outline" role="cell">
                  {isPublic ? <Eye size={13} /> : <EyeOff size={13} />}
                  {isPublic ? "Public" : "Private"}
                </Badge>
                <span className="publishedVersion" role="cell">v{version.versionNumber}</span>
                <time className="publishedUpdated" role="cell" dateTime={family.updatedAt} title={new Date(family.updatedAt).toLocaleString()}>
                  {relativeTime(family.updatedAt)}
                </time>
                <Button variant="ghost" size="icon-sm" className="publishedOpen" asChild>
                  <a href={route} aria-label={`Open ${route}`}><ArrowUpRight size={15} /></a>
                </Button>
              </div>
            );
          })}
        </div>
      );
  }
}
