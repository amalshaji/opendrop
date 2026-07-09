import { KeyRound, MessageSquarePlus, Terminal, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { currentSignInReturnTo, trustedLoginUrl } from "@/app/navigation";
import type { Session } from "./types";

interface AuthLandingProps {
  loading?: boolean;
  session: Session | null;
  devAuthEmail: string;
  setDevAuthEmail: (value: string) => void;
  devLogin: () => void;
  startOAuth: (provider: "github" | "google") => void;
}

export function AuthLanding({ loading = false, session, devAuthEmail, setDevAuthEmail, devLogin, startOAuth }: AuthLandingProps) {
  const approvingCli = location.pathname === "/device";
  return (
    <TooltipProvider>
      <main className="authPage">
        <section className="authHero" aria-label="OpenDrop sign in">
          <div className="authBrand">
            <span className="brandMark">O</span>
            <span>OpenDrop</span>
          </div>
          <div className="authCopy">
            <span className="eyebrow">Static preview operations</span>
            <h1>{approvingCli ? "Sign in to approve this CLI connection" : "Ship a static preview with a review room attached"}</h1>
            <p>
              {approvingCli
                ? "The CLI opened this browser window. Sign in, confirm the request, then return to your terminal."
                : "Push a static build from the dashboard or the CLI, share a versioned preview URL, and collect annotations your agents can read and act on."}
            </p>
          </div>
          <div className="authNotes" aria-label="What OpenDrop handles">
            <span><UploadCloud size={15} /> Upload static builds</span>
            <span><Terminal size={15} /> Publish from the CLI</span>
            <span><MessageSquarePlus size={15} /> Review with annotations</span>
          </div>
          {approvingCli ? null : (
            <div className="authTerminal" aria-label="Publish and review from the command line">
              <div className="authTerminalBar">
                <span className="termDot" aria-hidden="true" />
                <span className="termDot" aria-hidden="true" />
                <span className="termDot" aria-hidden="true" />
                <span className="authTerminalTitle">opendrop — agent-ready CLI</span>
              </div>
              <pre className="authTerminalBody">
                <code>
                  <span className="termLine"><span className="termPrompt">$</span> npx opendrop login</span>
                  <span className="termLine"><span className="termPrompt">$</span> npx opendrop upload ./dist --slug my-app</span>
                  <span className="termLine termOut">→ https://opendrop.app/you/my-app</span>
                  <span className="termLine"><span className="termPrompt">$</span> npx opendrop annotations you/my-app <span className="termComment"># hand review notes to your agent</span></span>
                </code>
              </pre>
            </div>
          )}
        </section>

        <Card className="authCard">
          <CardHeader>
            <div>
              <CardTitle>{loading ? "Checking session" : session?.authMode === "dev" ? "Dev Auth" : "Sign in"}</CardTitle>
              <CardDescription>
                {loading
                  ? "Connecting to your OpenDrop session."
                  : session?.authMode === "dev"
                    ? "Development mode is active. Enter an email to continue as that user."
                    : "Use a configured provider to continue."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="authCardContent">
            {loading ? (
              <div className="authLoading" aria-live="polite">Checking session...</div>
            ) : (
              <>
                {session?.authMode === "dev" ? (
                  <form
                    className="devAuthForm"
                    onSubmit={(event) => {
                      event.preventDefault();
                      devLogin();
                    }}
                  >
                    <label className="publishField">
                      <span>Email</span>
                      <Input
                        type="email"
                        value={devAuthEmail}
                        onChange={(event) => setDevAuthEmail(event.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                    </label>
                    <Button type="submit" disabled={!devAuthEmail.trim()}>
                      <KeyRound size={16} /> Continue with Dev Auth
                    </Button>
                  </form>
                ) : null}

                {session?.oauthProviders?.length ? (
                  <div className="oauthActions">
                    {session.oauthProviders.map((provider) => (
                      <Button key={provider} variant="outline" onClick={() => startOAuth(provider)}>
                        Continue with {provider === "github" ? "GitHub" : "Google"}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {session?.loginUrl ? (
                  <Button asChild variant="outline">
                    <a href={trustedLoginUrl(session.loginUrl, currentSignInReturnTo())}>Continue with organization session</a>
                  </Button>
                ) : null}

                {session?.authMode !== "dev" && !session?.oauthProviders?.length && !session?.loginUrl ? (
                  <div className="emptyState emptyStateCard">
                    <KeyRound size={18} />
                    <strong>No sign-in method configured.</strong>
                    <span>Configure OAuth or trusted-header auth before using the dashboard.</span>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </TooltipProvider>
  );
}
