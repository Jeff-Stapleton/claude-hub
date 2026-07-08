import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  api,
  type CreateProjectBody,
  type MachineTemplateBody,
  type RepoInput,
  type UpdateProjectBody,
} from '../api.js';
import type { PipelineMachine, UIState } from '../types.js';
import { DepthSorted, iso, poly, WALL_H, type SceneEntity } from './iso.js';
import type { SceneId } from './useSceneRouter.js';
import { AddMachinePanel } from './workshop/AddMachinePanel.jsx';
import { ChannelsRadio } from './workshop/ChannelsRadio.jsx';
import { CronClockWall } from './workshop/CronClockWall.jsx';
import { DebugOverlay } from './workshop/DebugOverlay.jsx';
import { ExitChute } from './workshop/ExitChute.jsx';
import { GhostLane } from './workshop/GhostLane.jsx';
import {
  BELT_LOCAL_Y,
  CONSOLE_X,
  HEAD_X,
  TOOLBOX_X,
  VAULT_X,
  consoleY,
  defaultPipeline,
  floorWidth,
  ghostLaneY,
  laneY,
  sceneTransform,
  toolboxY,
  vaultY,
  workshopFloorDepth,
} from './workshop/layout.js';
import { MachineConfigPanel } from './workshop/MachineConfigPanel.jsx';
import { NewProjectWizard } from './workshop/NewProjectWizard.jsx';
import { OrchestratorConsole } from './workshop/OrchestratorConsole.jsx';
import { ProjectLane } from './workshop/ProjectLane.jsx';
import { ProjectSettingsPanel } from './workshop/ProjectSettingsPanel.jsx';
import { RequestIntakeForm } from './workshop/RequestIntakeForm.jsx';
import { TimeCardWall } from './workshop/TimeCardWall.jsx';
import { ToolboxCrate } from './workshop/ToolboxCrate.jsx';
import { ToolboxPanel, type ToolboxAction } from './workshop/ToolboxPanel.jsx';
import { VaultPanel, type VaultAction } from './workshop/VaultPanel.jsx';
import { VaultSafe } from './workshop/VaultSafe.jsx';
import { WorkItemPanel } from './workshop/WorkItemPanel.jsx';

/**
 * Workshop home scene — the hub's one and only room. Every project owns a
 * full assembly lane (head machine, belt, installed stage machines, live
 * work items) stacked front-to-back; the floor deepens as projects are
 * added and the whole scene scales down to keep everything visible at a
 * glance inside the fixed 1600×900 stage.
 *
 * Z-order convention (see .cursor rules): iso() maps larger x+y farther
 * back, so floor-standing objects are routed through DepthSorted and
 * paint back-to-front — the object nearest world (0,0) paints last.
 * Walls/floor/wall-mounts paint before the sorted group; screen-space
 * panels after it.
 */

type WorkshopSelection =
  | { kind: 'machine'; projectId: string; machineKey: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'intake'; projectId: string }
  | { kind: 'addMachine'; projectId: string; insertIndex: number }
  | { kind: 'toolbox' }
  | { kind: 'vault' }
  | { kind: 'newProject' }
  | { kind: 'projectSettings'; projectId: string }
  | null;

const EMPTY_TOOLBOX = { skills: [], mcpServers: [] };

export function Workshop({
  state,
  navigate,
}: {
  state: UIState;
  navigate: (s: SceneId, param?: string) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [selection, setSelection] = useState<WorkshopSelection>(null);

  const activityQuery = useQuery({
    queryKey: ['activity'],
    queryFn: api.listActivity,
    refetchInterval: 10_000,
  });

  const createProjectMutation = useMutation({
    mutationFn: (body: CreateProjectBody) => api.createProject(body),
    onSuccess: () => {
      setSelection(null);
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: UpdateProjectBody }) =>
      api.updateProject(projectId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const repoMutation = useMutation({
    mutationFn: (action: RepoAction): Promise<unknown> => {
      switch (action.type) {
        case 'add':
          return api.addRepo(action.projectId, action.body);
        case 'retry':
          return api.retryRepo(action.projectId, action.repoId);
        case 'delete':
          return api.deleteRepo(action.projectId, action.repoId);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const saveMutation = useMutation({
    mutationFn: ({ projectId, machines }: { projectId: string; machines: PipelineMachine[] }) =>
      api.savePipeline(projectId, { machines }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const templateMutation = useMutation({
    mutationFn: (action: TemplateAction): Promise<unknown> =>
      action.type === 'create'
        ? api.createMachineTemplate(action.body)
        : api.deleteMachineTemplate(action.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const createMutation = useMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: { request: string; title?: string } }) =>
      api.createWorkItem(projectId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'retry' | 'cancel' }) =>
      action === 'approve'
        ? api.approveWorkItem(id)
        : action === 'retry'
          ? api.retryWorkItem(id)
          : api.cancelWorkItem(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const toolboxMutation = useMutation({
    mutationFn: (action: ToolboxAction): Promise<unknown> => {
      switch (action.type) {
        case 'create-skill':
          return api.createSkill(action.body);
        case 'update-skill':
          return api.updateSkill(action.id, action.body);
        case 'delete-skill':
          return api.deleteSkill(action.id);
        case 'create-server':
          return api.createMcpServer(action.body);
        case 'update-server':
          return api.updateMcpServer(action.id, action.body);
        case 'delete-server':
          return api.deleteMcpServer(action.id);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const vaultMutation = useMutation({
    mutationFn: (action: VaultAction): Promise<unknown> => {
      switch (action.type) {
        case 'create-key':
          return api.createVaultKey({
            key: action.key,
            ...(action.value !== undefined ? { value: action.value } : {}),
          });
        case 'set-value':
          return api.setVaultValue(action.key, action.value);
        case 'clear-value':
          return api.clearVaultValue(action.key);
        case 'delete-key':
          return api.deleteVaultKey(action.key);
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const activity = activityQuery.data ?? [];
  const projects = state.projects;
  const workItems = state.workItems ?? [];
  const machineTemplates = state.machineTemplates ?? [];

  const configFor = (projectId: string) => {
    const stored = state.pipelines?.find((p) => p.projectId === projectId);
    // Guard against a transient old-shape WS payload during server cutover.
    return stored?.machines ? stored : defaultPipeline(projectId);
  };

  // Width is fixed until some lane exceeds the baseline machine count, then
  // the room widens so machines keep their minimum spacing. Depth includes
  // the ghost lane's band, so the "add project" ghost always sits inside
  // the room and each new project grows the floor along +Y.
  const maxMachines = projects.reduce(
    (max, p) => Math.max(max, configFor(p.id).machines.length),
    0,
  );
  const floorW = floorWidth(maxMachines);
  const floorD = workshopFloorDepth(projects.length);
  const { s: sceneScale, tx, ty } = sceneTransform(floorW, floorD);

  // Recent trigger runs per project, for each lane's head-machine screen.
  const triggerProjectById = new Map(state.triggers.map((t) => [t.id, t.projectId]));
  const activityByProject = new Map<string, typeof activity>();
  for (const entry of activity) {
    const projectId = triggerProjectById.get(entry.run.triggerId);
    if (!projectId) continue;
    const entries = activityByProject.get(projectId) ?? [];
    if (entries.length < 3) {
      entries.push(entry);
      activityByProject.set(projectId, entries);
    }
  }

  const labelFor = (projectId: string): string => {
    const project = projects.find((p) => p.id === projectId);
    return project ? project.name : projectId;
  };
  const toggle = (next: Exclude<WorkshopSelection, null>): void =>
    setSelection((current) => (JSON.stringify(current) === JSON.stringify(next) ? null : next));

  // A WS push can delete the selected project/item/machine underneath the
  // panel — render from a validated view of the selection so the panel
  // just closes (or clamps its insertion index).
  const selected = validateSelection(selection, state, configFor);

  const nothingConfigured =
    projects.length === 0 &&
    state.triggers.length === 0 &&
    state.channels.length === 0 &&
    Object.keys(state.orchestrator.channelSessions).length === 0;

  // Floor-standing objects, depth-sorted back-to-front: each lane is one
  // entity (lanes occupy disjoint y bands); the console and tool box stand
  // against the back wall in the BACK_MARGIN band, behind every lane.
  const entities: SceneEntity[] = projects.map((project, laneIndex) => ({
    key: `lane-${project.id}`,
    anchor: { x: 0.4, y: laneY(laneIndex) },
    node: (
      <ProjectLane
        project={project}
        laneIndex={laneIndex}
        config={configFor(project.id)}
        items={workItems.filter((item) => item.projectId === project.id)}
        beltX1={floorW}
        triggerActivity={activityByProject.get(project.id) ?? []}
        selectedMachineKey={
          selected?.kind === 'machine' && selected.projectId === project.id
            ? selected.machineKey
            : null
        }
        selectedItemId={selected?.kind === 'item' ? selected.itemId : null}
        removing={deleteMutation.isPending && String(deleteMutation.variables ?? '') === project.id}
        onSelectMachine={(machineKey) => toggle({ kind: 'machine', projectId: project.id, machineKey })}
        onSelectItem={(itemId) => toggle({ kind: 'item', itemId })}
        onOpenIntake={() => toggle({ kind: 'intake', projectId: project.id })}
        onOpenAddMachine={(insertIndex) =>
          toggle({ kind: 'addMachine', projectId: project.id, insertIndex })
        }
        onOpenSettings={() => toggle({ kind: 'projectSettings', projectId: project.id })}
        onRemove={() => deleteMutation.mutate(project.id)}
      />
    ),
  }));
  entities.push({
    key: 'ghost-lane',
    anchor: { x: HEAD_X, y: ghostLaneY(projects.length) },
    node: (
      <GhostLane
        y0={ghostLaneY(projects.length)}
        beltX1={floorW}
        onActivate={() => toggle({ kind: 'newProject' })}
      />
    ),
  });
  entities.push({
    key: 'orchestrator',
    anchor: { x: CONSOLE_X, y: consoleY(floorD) },
    node: (
      <OrchestratorConsole
        state={state.orchestrator}
        y={consoleY(floorD)}
        onOpen={() => navigate('orchestrator')}
      />
    ),
  });
  const toolbox = state.toolbox ?? EMPTY_TOOLBOX;
  entities.push({
    key: 'toolbox',
    anchor: { x: TOOLBOX_X, y: toolboxY(floorD) },
    node: (
      <ToolboxCrate
        toolCount={toolbox.skills.length + toolbox.mcpServers.length}
        y={toolboxY(floorD)}
        onOpen={() => toggle({ kind: 'toolbox' })}
      />
    ),
  });
  const vault = state.vault ?? [];
  entities.push({
    key: 'vault',
    anchor: { x: VAULT_X, y: vaultY(floorD) },
    node: (
      <VaultSafe
        keyCount={vault.length}
        unsetCount={vault.filter((e) => !e.valueSet).length}
        y={vaultY(floorD)}
        onOpen={() => toggle({ kind: 'vault' })}
      />
    ),
  });

  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="claude-hub workshop"
    >
      {/* Lighting + glow gradient defs */}
      <defs>
        <radialGradient id="lampGlow" cx="0.5" cy="0.4" r="0.55">
          <stop offset="0%" stopColor="#ffd28a" stopOpacity={0.22} />
          <stop offset="55%" stopColor="#ffd28a" stopOpacity={0.06} />
          <stop offset="100%" stopColor="#ffd28a" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="floorShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2818" />
          <stop offset="100%" stopColor="#241810" />
        </linearGradient>
      </defs>

      {/* Everything world-anchored lives in the scale-to-fit wrapper. */}
      <g transform={`translate(${tx} ${ty}) scale(${sceneScale})`}>
        {/* Room background: walls first (farthest), then floor on top. */}
        <Walls floorW={floorW} floorD={floorD} />
        <Floor floorW={floorW} floorD={floorD} />

        {/* Wall-mounted fixtures, all on the back-left wall. Right to left:
            activity plaque (right edge floorW-0.7, 2.45 wide), cron clock
            wall (3.3 wide), channels box (2.3 wide), with 0.5 gaps. */}
        <TimeCardWall
          activity={activity}
          wallY={floorD}
          xEnd={floorW - 0.7}
          onOpen={() => navigate('activity')}
        />
        <CronClockWall
          triggers={state.triggers}
          wallY={floorD}
          xEnd={floorW - 3.65}
          onOpen={() => navigate('triggers')}
        />
        <ChannelsRadio
          channels={state.channels}
          wallY={floorD}
          xEnd={floorW - 7.45}
          onOpen={() => navigate('channels')}
        />
        {projects.map((project, laneIndex) => (
          <ExitChute key={project.id} wallX={floorW} beltY={laneY(laneIndex) + BELT_LOCAL_Y} />
        ))}

        {/* Floor-standing objects in enforced back-to-front paint order. */}
        <DepthSorted entities={entities} />

        {import.meta.env.DEV ? <DebugOverlay floorW={floorW} floorD={floorD} /> : null}
      </g>

      {/* Screen-space panels, outside the scale wrapper. */}
      {selected?.kind === 'machine' && selected.machine ? (
        <MachineConfigPanel
          key={`${selected.projectId}:${selected.machineKey}`}
          projectLabel={labelFor(selected.projectId)}
          machine={selected.machine}
          templateBlurb={
            machineTemplates.find((t) => t.id === selected.machine.templateId)?.description
          }
          toolbox={toolbox}
          vault={vault}
          isPending={saveMutation.isPending}
          error={saveMutation.error}
          onSave={(next) =>
            saveMutation.mutate({
              projectId: selected.projectId,
              machines: configFor(selected.projectId).machines.map((m) =>
                m.key === next.key ? next : m,
              ),
            })
          }
          onRemove={() => {
            saveMutation.mutate({
              projectId: selected.projectId,
              machines: configFor(selected.projectId).machines.filter(
                (m) => m.key !== selected.machineKey,
              ),
            });
            setSelection(null);
          }}
          onCreateVaultKey={(key) => vaultMutation.mutate({ type: 'create-key', key })}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'item' && selected.item ? (
        <WorkItemPanel
          item={selected.item}
          machines={configFor(selected.item.projectId).machines}
          isPending={actionMutation.isPending}
          error={actionMutation.error}
          onApprove={() => actionMutation.mutate({ id: selected.item.id, action: 'approve' })}
          onRetry={() => actionMutation.mutate({ id: selected.item.id, action: 'retry' })}
          onCancel={() => actionMutation.mutate({ id: selected.item.id, action: 'cancel' })}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'intake' ? (
        <RequestIntakeForm
          key={selected.projectId}
          projectLabel={labelFor(selected.projectId)}
          noMachines={configFor(selected.projectId).machines.length === 0}
          isPending={createMutation.isPending}
          error={createMutation.error}
          onSubmit={(body) => createMutation.mutate({ projectId: selected.projectId, body })}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'toolbox' ? (
        <ToolboxPanel
          toolbox={toolbox}
          vault={vault}
          isPending={toolboxMutation.isPending}
          error={toolboxMutation.error}
          onAction={(action) => toolboxMutation.mutate(action)}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'vault' ? (
        <VaultPanel
          vault={vault}
          isPending={vaultMutation.isPending}
          error={vaultMutation.error}
          onAction={(action) => vaultMutation.mutate(action)}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'addMachine' ? (
        <AddMachinePanel
          key={`${selected.projectId}:${selected.insertIndex}`}
          projectLabel={labelFor(selected.projectId)}
          insertIndex={selected.insertIndex}
          machineCount={configFor(selected.projectId).machines.length}
          existingKeys={configFor(selected.projectId).machines.map((m) => m.key)}
          templates={machineTemplates}
          toolbox={toolbox}
          vault={vault}
          isPending={saveMutation.isPending || templateMutation.isPending}
          error={saveMutation.error ?? templateMutation.error}
          onInstall={(machine, saveAsTemplate) => {
            const machines = configFor(selected.projectId).machines;
            saveMutation.mutate(
              {
                projectId: selected.projectId,
                machines: [
                  ...machines.slice(0, selected.insertIndex),
                  machine,
                  ...machines.slice(selected.insertIndex),
                ],
              },
              { onSuccess: () => setSelection(null) },
            );
            if (saveAsTemplate) templateMutation.mutate({ type: 'create', body: saveAsTemplate });
          }}
          onDeleteTemplate={(id) => templateMutation.mutate({ type: 'delete', id })}
          onCreateVaultKey={(key) => vaultMutation.mutate({ type: 'create-key', key })}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'newProject' ? (
        <NewProjectWizard
          toolbox={toolbox}
          credentials={state.gitCredentials ?? []}
          projectsRoot={state.config.projectsRoot}
          isPending={createProjectMutation.isPending}
          error={createProjectMutation.error}
          onCreate={(body) => createProjectMutation.mutate(body)}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selected?.kind === 'projectSettings' && selected.project ? (
        <ProjectSettingsPanel
          key={selected.projectId}
          project={selected.project}
          toolbox={toolbox}
          credentials={state.gitCredentials ?? []}
          isPending={updateProjectMutation.isPending || repoMutation.isPending}
          error={updateProjectMutation.error ?? repoMutation.error}
          onSave={(body) =>
            updateProjectMutation.mutate({ projectId: selected.projectId, body })
          }
          onAddRepo={(body) =>
            repoMutation.mutate({ type: 'add', projectId: selected.projectId, body })
          }
          onRetryRepo={(repoId) =>
            repoMutation.mutate({ type: 'retry', projectId: selected.projectId, repoId })
          }
          onDeleteRepo={(repoId) =>
            repoMutation.mutate({ type: 'delete', projectId: selected.projectId, repoId })
          }
          onClose={() => setSelection(null)}
        />
      ) : null}

      {/* Warm lamp glow overlay (non-interactive) */}
      <rect x={0} y={0} width={1600} height={900} fill="url(#lampGlow)" pointerEvents="none" />

      {nothingConfigured ? (
        <text
          x={800}
          y={60}
          textAnchor="middle"
          fontSize={13}
          fill="#c8a888"
          opacity={0.7}
          fontStyle="italic"
        >
          click any workstation to begin
        </text>
      ) : null}
    </svg>
  );
}

type RepoAction =
  | { type: 'add'; projectId: string; body: RepoInput }
  | { type: 'retry'; projectId: string; repoId: string }
  | { type: 'delete'; projectId: string; repoId: string };

type TemplateAction =
  | { type: 'create'; body: MachineTemplateBody }
  | { type: 'delete'; id: string };

type ValidatedSelection =
  | { kind: 'machine'; projectId: string; machineKey: string; machine: PipelineMachine }
  | { kind: 'item'; itemId: string; item: NonNullable<UIState['workItems']>[number] }
  | { kind: 'intake'; projectId: string }
  | { kind: 'addMachine'; projectId: string; insertIndex: number }
  | { kind: 'toolbox' }
  | { kind: 'vault' }
  | { kind: 'newProject' }
  | { kind: 'projectSettings'; projectId: string; project: UIState['projects'][number] }
  | null;

function validateSelection(
  selection: WorkshopSelection,
  state: UIState,
  configFor: (projectId: string) => { machines: PipelineMachine[] },
): ValidatedSelection {
  if (!selection) return null;
  if (
    selection.kind === 'toolbox' ||
    selection.kind === 'vault' ||
    selection.kind === 'newProject'
  ) {
    return selection;
  }
  if (selection.kind === 'item') {
    const item = (state.workItems ?? []).find((it) => it.id === selection.itemId);
    return item ? { ...selection, item } : null;
  }
  if (selection.kind === 'projectSettings') {
    const project = state.projects.find((p) => p.id === selection.projectId);
    return project ? { ...selection, project } : null;
  }
  if (!state.projects.some((p) => p.id === selection.projectId)) return null;
  if (selection.kind === 'machine') {
    const machine = configFor(selection.projectId).machines.find(
      (m) => m.key === selection.machineKey,
    );
    return machine ? { ...selection, machine } : null;
  }
  if (selection.kind === 'addMachine') {
    const count = configFor(selection.projectId).machines.length;
    return { ...selection, insertIndex: Math.min(selection.insertIndex, count) };
  }
  return selection;
}

/** Floor rhombus + faint tile grid, sized to the current room. */
function Floor({ floorW, floorD }: { floorW: number; floorD: number }): JSX.Element {
  // Floor corners in world coords: F=front, R=back-right, B=back, L=back-left
  const F = iso(0, 0, 0);
  const R = iso(floorW, 0, 0);
  const B = iso(floorW, floorD, 0);
  const L = iso(0, floorD, 0);

  // Tile grid lines, 1 world unit apart. Drawn faintly so they suggest
  // floorboards or tiles without dominating.
  const lines: Array<{ a: ReturnType<typeof iso>; b: ReturnType<typeof iso> }> = [];
  for (let i = 1; i < floorD; i++) {
    // Lines parallel to the +X axis (constant Y)
    lines.push({ a: iso(0, i, 0), b: iso(floorW, i, 0) });
  }
  for (let i = 1; i < floorW; i++) {
    // Lines parallel to the +Y axis (constant X)
    lines.push({ a: iso(i, 0, 0), b: iso(i, floorD, 0) });
  }

  return (
    <g>
      <polygon points={poly(F, R, B, L)} fill="url(#floorShade)" stroke="#1a110a" strokeWidth={2} />
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.a.x}
          y1={l.a.y}
          x2={l.b.x}
          y2={l.b.y}
          stroke="#1a110a"
          strokeWidth={0.6}
          opacity={0.55}
        />
      ))}
    </g>
  );
}

/** Back-left wall (y=floorD) and back-right wall (x=floorW). */
function Walls({ floorW, floorD }: { floorW: number; floorD: number }): JSX.Element {
  // Back-left wall: from back-corner to back-left corner, rising WALL_H.
  const bl0 = iso(floorW, floorD, 0);
  const bl1 = iso(0, floorD, 0);
  const bl2 = iso(0, floorD, WALL_H);
  const bl3 = iso(floorW, floorD, WALL_H);

  // Back-right wall: from back-corner to back-right corner, rising WALL_H.
  const br0 = iso(floorW, floorD, 0);
  const br1 = iso(floorW, 0, 0);
  const br2 = iso(floorW, 0, WALL_H);
  const br3 = iso(floorW, floorD, WALL_H);

  return (
    <g>
      {/* Back-left wall — slightly darker (shadow side) */}
      <polygon points={poly(bl0, bl1, bl2, bl3)} fill="#1f1610" stroke="#0e0a06" strokeWidth={1.5} />
      {/* Plank lines on back-left wall */}
      {[1, 2].map((z) => {
        const a = iso(0, floorD, z);
        const b = iso(floorW, floorD, z);
        return <line key={`bl-${z}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e0a06" strokeWidth={1} opacity={0.7} />;
      })}

      {/* Back-right wall — slightly lighter (lit side) */}
      <polygon points={poly(br0, br1, br2, br3)} fill="#2a1d14" stroke="#0e0a06" strokeWidth={1.5} />
      {/* Plank lines on back-right wall */}
      {[1, 2].map((z) => {
        const a = iso(floorW, 0, z);
        const b = iso(floorW, floorD, z);
        return <line key={`br-${z}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e0a06" strokeWidth={1} opacity={0.7} />;
      })}

      {/* Corner seam where the two walls meet, slightly darker */}
      {(() => {
        const a = iso(floorW, floorD, 0);
        const b = iso(floorW, floorD, WALL_H);
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0a0805" strokeWidth={2} />;
      })()}
    </g>
  );
}

