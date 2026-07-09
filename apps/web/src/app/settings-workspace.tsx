import type { Dispatch, SetStateAction } from "react";
import { KeyRound, Plus, Trash2, UserPlus, Users } from "lucide-react";
import type { CliConnection, NamespaceAccess, NamespaceMember, SettingsTab } from "@/app/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SettingsWorkspaceProps {
  settingsTab: SettingsTab;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  namespaces: NamespaceAccess[];
  namespaceMembers: Record<string, NamespaceMember[]>;
  newNamespace: string;
  setNewNamespace: Dispatch<SetStateAction<string>>;
  publisherDrafts: Record<string, string>;
  setPublisherDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  connections: CliConnection[];
  loadNamespaces: () => void | Promise<void>;
  loadConnections: () => void | Promise<void>;
  createCustomNamespace: () => void | Promise<void>;
  addPublisher: (namespaceName: string) => void | Promise<void>;
  removePublisher: (namespaceName: string, userId: string) => void | Promise<void>;
  revokeConnection: (id: string) => void | Promise<void>;
}

export function SettingsWorkspace({
  settingsTab,
  setSettingsTab,
  namespaces,
  namespaceMembers,
  newNamespace,
  setNewNamespace,
  publisherDrafts,
  setPublisherDrafts,
  connections,
  loadNamespaces,
  loadConnections,
  createCustomNamespace,
  addPublisher,
  removePublisher,
  revokeConnection
}: SettingsWorkspaceProps) {
  return (
    <div className="settingsStack">
      <div className="settingsTabs" role="tablist" aria-label="Settings sections">
        <Button
          type="button"
          variant="ghost"
          role="tab"
          aria-selected={settingsTab === "namespaces"}
          className={settingsTab === "namespaces" ? "isActive" : ""}
          onClick={() => {
            setSettingsTab("namespaces");
            loadNamespaces();
          }}
        >
          Namespaces <span>{namespaces.length}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          role="tab"
          aria-selected={settingsTab === "connections"}
          className={settingsTab === "connections" ? "isActive" : ""}
          onClick={() => {
            setSettingsTab("connections");
            loadConnections();
          }}
        >
          Connections <span>{connections.length}</span>
        </Button>
      </div>

      {settingsTab === "namespaces" ? (
        <Card className="settingsPanel">
          <CardHeader>
            <div>
              <CardTitle>Namespaces</CardTitle>
              <CardDescription>Create custom namespaces and grant publisher access to existing users.</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" onClick={loadNamespaces}>Refresh</Button>
            </CardAction>
          </CardHeader>
          <CardContent className="namespacePanelContent">
            <div className="namespaceCreate">
              <Input value={newNamespace} onChange={(event) => setNewNamespace(event.target.value)} placeholder="namespace name" />
              <Button onClick={createCustomNamespace} disabled={!newNamespace.trim()}>
                <Plus size={16} /> Create
              </Button>
            </div>

            <div className="namespaceList">
              {namespaces.map((item) => {
                const members = namespaceMembers[item.name] || [];
                const roleLabel = item.role === "owner" ? "Owner" : "Publisher";
                return (
                  <div className="namespaceItem" key={item.name}>
                    <div className="namespaceItemHeader">
                      <div>
                        <strong>/{item.name}</strong>
                        <span>{roleLabel} access</span>
                      </div>
                      <Badge className={`roleBadge ${item.role === "owner" ? "roleBadgeOwner" : "roleBadgePublisher"}`} variant="outline">
                        {roleLabel}
                      </Badge>
                    </div>

                    {item.role === "owner" ? (
                      <div className="publisherAccess">
                        <div className="publisherAccessHeader">
                          <div>
                            <strong>Publisher access</strong>
                            <span>Existing users can publish new drops into this namespace.</span>
                          </div>
                          <span>{members.length} {members.length === 1 ? "member" : "members"}</span>
                        </div>
                        <div className="publisherForm">
                          <UserPlus size={16} />
                          <Input
                            autoComplete="email"
                            type="email"
                            value={publisherDrafts[item.name] || ""}
                            onChange={(event) => setPublisherDrafts((current) => ({ ...current, [item.name]: event.target.value }))}
                            placeholder="publisher email"
                          />
                          <Button variant="outline" onClick={() => addPublisher(item.name)} disabled={!publisherDrafts[item.name]?.trim()}>
                            Add publisher
                          </Button>
                        </div>
                        <div className="memberList">
                          {members.map((member) => (
                            <div className="memberRow" key={`${item.name}-${member.userId}`}>
                              <Users size={15} />
                              <div>
                                <strong>{member.email}</strong>
                                <span>{member.role === "owner" ? "Owner" : "Publisher"}</span>
                              </div>
                              {member.role === "publisher" ? (
                                <Button variant="ghost" onClick={() => removePublisher(item.name, member.userId)} aria-label={`Remove ${member.email}`}>
                                  <Trash2 size={15} />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {namespaces.length === 0 ? (
                <div className="emptyState emptyStateCard">
                  <Users size={18} />
                  <strong>No namespaces yet.</strong>
                  <span>Create a namespace above to organize deployment ownership.</span>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {settingsTab === "connections" ? (
        <Card className="settingsPanel">
          <CardHeader>
            <div>
              <CardTitle>Connections</CardTitle>
              <CardDescription>CLI connections connected to this account.</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" onClick={loadConnections}>Refresh</Button>
            </CardAction>
          </CardHeader>
          <CardContent className="connectionList">
            {connections.map((connection) => (
              <div className="connection" key={connection.id}>
                <div>
                  <strong>{connection.label || "OpenDrop CLI"}</strong>
                  <span>{connection.deviceName || "Unknown machine"}</span>
                  <span>Created {new Date(connection.createdAt).toLocaleString()}</span>
                  {connection.revokedAt ? <span>Revoked {new Date(connection.revokedAt).toLocaleString()}</span> : null}
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={Boolean(connection.revokedAt)}>
                      Revoke
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke this CLI connection?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {connection.label || "OpenDrop CLI"} will lose access immediately. You can reconnect from the CLI if needed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction className="destructiveAction" onClick={() => revokeConnection(connection.id)}>
                        Revoke connection
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
            {connections.length === 0 ? (
              <div className="emptyState emptyStateCard">
                <KeyRound size={18} />
                <strong>No connections yet.</strong>
                <span>CLI connections appear here after they are approved from the browser.</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
