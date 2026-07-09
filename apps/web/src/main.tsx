import "vite/modulepreload-polyfill";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parsePreviewRoute } from "@/app/format";
import { AuthLanding } from "@/app/auth-landing";
import { DashboardShell } from "@/app/dashboard-shell";
import { DeviceApprovalPanel } from "@/app/device-approval-panel";
import { PreviewLoading } from "@/app/preview-loading";
import { PreviewRoom } from "@/app/preview-room";
import { SettingsWorkspace } from "@/app/settings-workspace";
import { UploadWorkspace } from "@/app/upload-workspace";
import { useAuthSession } from "@/app/use-auth-session";
import { useDeviceApproval } from "@/app/use-device-approval";
import { usePreviewWorkspace } from "@/app/use-preview-workspace";
import { useSettingsWorkspace } from "@/app/use-settings-workspace";
import { useUploadWorkflow } from "@/app/use-upload-workflow";
import type { DashboardView } from "@/app/types";
import "./styles.css";

function App() {
  const previewRoute = useMemo(() => parsePreviewRoute(location.pathname, location.search), []);
  const [status, setStatus] = useState("");
  const [view, setView] = useState<DashboardView>(() => (location.pathname === "/device" ? "device" : "uploads"));
  const auth = useAuthSession({ setStatus, onLogout: () => undefined });
  const preview = usePreviewWorkspace({ previewRoute, session: auth.session, setStatus });
  const upload = useUploadWorkflow({ session: auth.session, setStatus, onPublished: preview.handlePublished });
  const settings = useSettingsWorkspace({ setStatus });
  const device = useDeviceApproval({ setStatus, loadConnections: settings.loadConnections });

  useEffect(() => {
    if (view === "device" && auth.session?.authenticated && device.deviceCode) {
      void device.loadDeviceRequest();
    }
  }, [view, auth.session?.authenticated, device.deviceCode]);

  const activeSidebarItem = view === "uploads" && (preview.publish || previewRoute) ? "previews" : view;
  const pageTitle = previewRoute
    ? `/${previewRoute.namespace}/${previewRoute.slug}`
    : view === "settings"
      ? "Settings"
      : view === "device"
        ? "Approve CLI connection"
        : preview.publish
          ? "Preview and annotate"
          : "Publish a static drop";
  const pageSubtitle = previewRoute
    ? "Review the live preview, versions, and annotations."
    : view === "settings"
      ? "Manage namespaces, publishers, and CLI connections."
      : view === "device"
        ? "Confirm the request opened by the CLI, then return to the terminal."
        : preview.publish
          ? "Inspect the published preview, switch versions, and leave review notes."
          : "Upload a folder or zip, review validation, then share a versioned preview.";
  const statusLabel = status || (auth.session ? "Idle" : "Checking session");
  const hasReviewWorkspace = Boolean(preview.publish || previewRoute || upload.lastPublished);

  async function createCustomNamespace() {
    const namespace = await settings.createCustomNamespace();
    if (namespace) upload.setNamespace(namespace);
  }

  async function showConnections() {
    setView("settings");
    await settings.showConnections();
  }

  if (!auth.session) {
    return (
      <AuthLanding
        loading
        session={auth.session}
        devAuthEmail={auth.devAuthEmail}
        setDevAuthEmail={auth.setDevAuthEmail}
        devLogin={auth.devLogin}
        startOAuth={auth.startOAuth}
      />
    );
  }

  if (!auth.session.authenticated && !previewRoute) {
    return (
      <AuthLanding
        session={auth.session}
        devAuthEmail={auth.devAuthEmail}
        setDevAuthEmail={auth.setDevAuthEmail}
        devLogin={auth.devLogin}
        startOAuth={auth.startOAuth}
      />
    );
  }

  if (preview.publish) {
    return (
      <PreviewRoom
        session={auth.session}
        publish={preview.publish}
        versions={preview.versions}
        activeVersionId={preview.activeVersionId}
        previewSrc={preview.previewSrc}
        frameRef={preview.frameRef}
        iframeRef={preview.iframeRef}
        commentsOpen={preview.commentsOpen}
        setCommentsOpen={preview.setCommentsOpen}
        annotationMode={preview.annotationMode}
        chooseAnnotationMode={preview.chooseAnnotationMode}
        setBridgeNonce={preview.setBridgeNonce}
        isPublishedOwner={preview.isPublishedOwner}
        publishedVisibility={preview.publishedVisibility}
        selectVersion={preview.selectVersion}
        restoreActiveVersion={preview.restoreActiveVersion}
        updatePublishedVisibility={preview.updatePublishedVisibility}
        copyVersionUrl={preview.copyVersionUrl}
        draftShape={preview.draftShape}
        annotation={preview.annotation}
        setAnnotation={preview.setAnnotation}
        isSubmitShortcut={preview.isSubmitShortcut}
        addAnnotation={preview.addAnnotation}
        annotations={preview.annotations}
        openAnnotationCount={preview.openAnnotationCount}
        visibleRootAnnotations={preview.visibleRootAnnotations}
        repliesByParent={preview.repliesByParent}
        selectedAnnotationId={preview.selectedAnnotationId}
        setSelectedAnnotationId={preview.setSelectedAnnotationId}
        replyDrafts={preview.replyDrafts}
        setReplyDrafts={preview.setReplyDrafts}
        replyingTo={preview.replyingTo}
        setReplyingTo={preview.setReplyingTo}
        showResolved={preview.showResolved}
        setShowResolved={preview.setShowResolved}
        addReply={preview.addReply}
        handleReplyKeyDown={preview.handleReplyKeyDown}
        setAnnotationResolved={preview.setAnnotationResolved}
      />
    );
  }

  if (previewRoute) return <PreviewLoading status={status} authenticated={Boolean(auth.session.authenticated)} />;

  return (
    <DashboardShell
      session={auth.session}
      activeSidebarItem={activeSidebarItem}
      hasReviewWorkspace={hasReviewWorkspace}
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      status={status}
      statusLabel={statusLabel}
      setView={setView}
      setSettingsTab={settings.setSettingsTab}
      setStatus={setStatus}
      chooseAnnotationMode={preview.chooseAnnotationMode}
      loadSettings={settings.loadSettings}
      logout={auth.logout}
    >
      {view === "uploads" ? (
        <UploadWorkspace
          files={upload.files}
          uploadDragging={upload.uploadDragging}
          setUploadDragging={upload.setUploadDragging}
          uploadErrors={upload.uploadErrors}
          folderInputRef={upload.folderInputRef}
          zipInputRef={upload.zipInputRef}
          acceptUploadFiles={upload.acceptUploadFiles}
          clearUploadFiles={upload.clearUploadFiles}
          handleUploadDrop={upload.handleUploadDrop}
          routePreview={upload.routePreview}
          lastPublished={upload.lastPublished}
          lastPublishedHref={upload.lastPublishedHref}
          lastPublishedDisplayUrl={upload.lastPublishedDisplayUrl}
          copyLastPublishedUrl={upload.copyLastPublishedUrl}
          validation={upload.validation}
          namespace={upload.namespace}
          setNamespace={upload.setNamespace}
          slug={upload.slug}
          setSlug={upload.setSlug}
          visibility={upload.visibility}
          setVisibility={upload.setVisibility}
          publishUpload={upload.publishUpload}
          isPublishing={upload.isPublishing}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsWorkspace
          settingsTab={settings.settingsTab}
          setSettingsTab={settings.setSettingsTab}
          namespaces={settings.namespaces}
          namespaceMembers={settings.namespaceMembers}
          newNamespace={settings.newNamespace}
          setNewNamespace={settings.setNewNamespace}
          publisherDrafts={settings.publisherDrafts}
          setPublisherDrafts={settings.setPublisherDrafts}
          connections={settings.connections}
          loadNamespaces={settings.loadNamespaces}
          loadConnections={settings.loadConnections}
          createCustomNamespace={createCustomNamespace}
          addPublisher={settings.addPublisher}
          removePublisher={settings.removePublisher}
          revokeConnection={settings.revokeConnection}
        />
      ) : null}

      {view === "device" ? (
        <DeviceApprovalPanel
          deviceCode={device.deviceCode}
          deviceRequest={device.deviceRequest}
          loadDeviceRequest={device.loadDeviceRequest}
          decideDevice={device.decideDevice}
          showConnections={showConnections}
        />
      ) : null}
    </DashboardShell>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
