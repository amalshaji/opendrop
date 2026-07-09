import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const colors = {
  background: "#f4f4ef",
  foreground: "#1f241f",
  muted: "#6c7169",
  border: "#cecfc7",
  borderSoft: "#ddded6",
  primary: "#043f2e",
  accent: "#0c6b58",
  accentSoft: "#e7f1eb",
  card: "#ffffff"
};

const fontBody = "Geist, Inter, ui-sans-serif, system-ui, sans-serif";
const fontHeading = "Sora, Inter, ui-sans-serif, system-ui, sans-serif";
const fontMono = "'Fragment Mono', ui-monospace, SFMono-Regular, monospace";

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function Comment({ y, progress, title, meta }: { y: number; progress: number; title: string; meta: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        top: y,
        width: 204,
        minHeight: 66,
        background: colors.card,
        border: `1px solid ${colors.borderSoft}`,
        borderLeft: `3px solid ${colors.accent}`,
        padding: "12px 14px",
        opacity: progress,
        transform: `translateX(${(1 - progress) * 34}px)`
      }}
    >
      <div style={{ fontFamily: fontBody, color: colors.foreground, fontSize: 13.5, fontWeight: 750, lineHeight: 1.25 }}>{title}</div>
      <div style={{ fontFamily: fontMono, color: colors.muted, fontSize: 9.5, marginTop: 9 }}>{meta}</div>
    </div>
  );
}

function StatusPill({ label, progress }: { label: string; progress: number }) {
  return (
    <div
      style={{
        height: 34,
        padding: "0 13px",
        background: colors.card,
        border: `1px solid ${colors.borderSoft}`,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 12}px)`
      }}
    >
      <div style={{ width: 8, height: 8, background: colors.accent }} />
      <span style={{ fontFamily: fontMono, color: colors.foreground, fontSize: 11 }}>{label}</span>
    </div>
  );
}

function ReviewTab() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = frame / Math.max(1, durationInFrames - 1);

  const upload = spring({ frame: frame - 5, fps: 24, config: { damping: 15, stiffness: 110 } });
  const validate = spring({ frame: frame - 22, fps: 24, config: { damping: 15, stiffness: 110 } });
  const publish = spring({ frame: frame - 40, fps: 24, config: { damping: 15, stiffness: 110 } });
  const commentOne = spring({ frame: frame - 52, fps: 24, config: { damping: 16, stiffness: 110 } });
  const commentTwo = spring({ frame: frame - 68, fps: 24, config: { damping: 16, stiffness: 110 } });
  const commentThree = spring({ frame: frame - 84, fps: 24, config: { damping: 16, stiffness: 110 } });

  const highlight = clamp(interpolate(progress, [0.32, 0.54], [0, 1]));
  const version = Math.floor(interpolate(progress, [0, 1], [1, 4]));
  const pinPulse = 0.5 + Math.sin(frame / 7) * 0.5;

  return (
    <div
      style={{
        position: "absolute",
        left: 58,
        top: 50,
        width: 844,
        height: 378,
        background: colors.card,
        border: `1px solid ${colors.border}`,
        boxShadow: "0 24px 58px rgba(22, 26, 23, 0.18)",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          height: 42,
          background: "#eceee7",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 15px"
        }}
      >
        {[0, 1, 2].map((dot) => (
          <div key={dot} style={{ width: 8, height: 8, borderRadius: 8, background: "#c7cabf" }} />
        ))}
        <div
          style={{
            marginLeft: 18,
            width: 318,
            height: 20,
            background: "#f9faf6",
            border: `1px solid ${colors.borderSoft}`,
            color: colors.muted,
            fontFamily: fontMono,
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            paddingLeft: 13
          }}
        >
          /amal/launch?version={version}
        </div>
        <div style={{ marginLeft: "auto", color: colors.muted, fontFamily: fontMono, fontSize: 10 }}>OpenDrop review room</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 42,
          width: 580,
          height: 336,
          backgroundColor: "#fbfbf8",
          backgroundImage:
            "linear-gradient(90deg, rgba(222,223,215,.85) 1px, transparent 1px), linear-gradient(0deg, rgba(222,223,215,.85) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          padding: 34
        }}
      >
        <div
          style={{
            position: "relative",
            height: 220,
            background: colors.card,
            border: `1px solid ${colors.borderSoft}`,
            padding: 28,
            overflow: "hidden"
          }}
        >
          <div style={{ position: "absolute", left: 28, top: 28, right: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: fontHeading, fontSize: 15, fontWeight: 800 }}>Atlas CRM</div>
            <div style={{ display: "flex", gap: 14, color: colors.muted, fontSize: 10, fontFamily: fontMono }}>
              <span>Pipeline</span>
              <span>Reports</span>
              <span>Settings</span>
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: 28,
              top: 74,
              display: "inline-flex",
              height: 22,
              padding: "0 9px",
              alignItems: "center",
              background: colors.accentSoft,
              border: `1px solid ${colors.borderSoft}`,
              color: colors.accent,
              fontFamily: fontMono,
              fontSize: 9.5,
              fontWeight: 700
            }}
          >
            Q3 dashboard
          </div>

          <div style={{ position: "absolute", left: 28, top: 110, fontFamily: fontHeading, fontSize: 22, lineHeight: 1.07, fontWeight: 850, width: 310 }}>
            Close enterprise deals before the quarter ends.
          </div>

          <div style={{ position: "absolute", left: 28, top: 166, width: 360, color: colors.muted, fontSize: 12.5, lineHeight: 1.4 }}>
            <div>Prioritize accounts with expansion signals and forecast risk.</div>
            <div>Reps now respond within 15 minutes after routing.</div>
          </div>

          <div
            style={{
              position: "absolute",
              left: 88,
              top: 184,
              width: 154 * highlight,
              height: 19,
              background: colors.accentSoft,
              border: `1px solid rgba(12, 107, 88, ${0.22 + highlight * 0.33})`,
              overflow: "hidden"
            }}
          >
            <div style={{ width: 154, color: colors.foreground, fontSize: 12.5, lineHeight: "17px", paddingLeft: 3 }}>respond within 15 minutes</div>
          </div>

          <div
            style={{
              position: "absolute",
              right: 28,
              bottom: 22,
              height: 30,
              padding: "0 13px",
              background: colors.primary,
              color: colors.card,
              display: "flex",
              alignItems: "center",
              fontFamily: fontBody,
              fontSize: 12,
              fontWeight: 800
            }}
          >
            Book demo
          </div>

          <div
            style={{
              position: "absolute",
              left: 248,
              top: 176,
              width: 28,
              height: 28,
              background: colors.accent,
              color: colors.card,
              display: "grid",
              placeItems: "center",
              fontFamily: fontHeading,
              fontWeight: 900,
              fontSize: 14,
              boxShadow: `0 0 ${10 + pinPulse * 18}px rgba(12,107,88,.32)`,
              opacity: highlight
            }}
          >
            1
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <StatusPill label="folder.zip accepted" progress={upload} />
          <StatusPill label="index.html validated" progress={validate} />
          <StatusPill label="v4 published" progress={publish} />
        </div>

      </div>

      <div
        style={{
          position: "absolute",
          right: 0,
          top: 42,
          width: 264,
          height: 336,
          background: "#f9faf6",
          borderLeft: `1px solid ${colors.borderSoft}`,
          padding: 20
        }}
      >
        <div style={{ fontFamily: fontHeading, fontWeight: 800, fontSize: 17 }}>Review room</div>
        <div style={{ color: colors.muted, fontFamily: fontMono, fontSize: 10, marginTop: 5 }}>3 open threads</div>
        <Comment y={72} progress={commentOne} title="Can we prove the 15 minute SLA?" meta="you - v4 - text highlight" />
        <Comment y={152} progress={commentTwo} title="CTA should say Start review, not Book demo." meta="maya - /pricing - open" />
        <Comment y={232} progress={commentThree} title="Agent fetched this thread with page HTML." meta="agent - current page" />
      </div>
    </div>
  );
}

export function ReadmeDemo() {
  return (
    <AbsoluteFill
      style={{
        background: colors.background,
        color: colors.foreground,
        fontFamily: fontBody,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(90deg, rgba(222,223,215,.72) 1px, transparent 1px), linear-gradient(0deg, rgba(222,223,215,.72) 1px, transparent 1px)",
          backgroundSize: "44px 44px"
        }}
      />
      <ReviewTab />
    </AbsoluteFill>
  );
}
