import { Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

interface PreviewLoadingProps {
  status: string;
  authenticated: boolean;
}

export function PreviewLoading({ status, authenticated }: PreviewLoadingProps) {
  const unavailable = /not available|not found|unavailable|invalid/i.test(status);
  return (
    <TooltipProvider>
      <div className="previewRoom previewRoomEmpty">
        <div className="roomEmptyCard">
          <Globe2 size={20} />
          <strong>{unavailable ? "Preview unavailable" : "Loading preview"}</strong>
          <span>{status || "Fetching the latest published version…"}</span>
          <Button variant="outline" onClick={() => { location.href = "/"; }}>
            {authenticated ? "Go to dashboard" : "Sign in"}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
