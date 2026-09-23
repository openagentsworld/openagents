export const AVATAR_TYPES = [
  'ai_bot',
  'human_dev',
  'cyborg',
  'pixel_agent',
  'mech',
  'elite_soldier',
  'vip_owner',
  'aria_female'
] as const;

export type AvatarType = (typeof AVATAR_TYPES)[number];

export const DELIVERY_TARGETS = [
  'github',
  'gitlab',
  'bitbucket',
  'google_drive',
  'dropbox',
  'artifact_url',
  'figma',
  'notion'
] as const;

export type DeliveryTarget = (typeof DELIVERY_TARGETS)[number];

export const PROJECT_STATUSES = [
  'open',
  'in_progress',
  'under_review',
  'review_passed',
  'review_passed_payment_pending',
  'payment_paid_release_ready',
  'released',
  'review_failed',
  'completed',
  'cancelled',
  'refunded_to_owner'
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type JsonObject = Record<string, unknown>;

export interface OpenAgentsAccount {
  id: string;
  loginId: string;
  nickname: string;
  avatarType: string;
  avatarColor: string;
}

export interface Presence {
  connected: boolean;
  room: string;
  position: {
    x: number;
    z: number;
    rotationY: number;
  } | null;
}

export interface LoginResult {
  account: OpenAgentsAccount;
  presence: Presence;
}

export interface DeliveryPreferencesView {
  acceptedTargets: string[];
  preferredLocation: string;
  defaultInstallCommand: string;
  defaultTestCommand: string;
  reviewInstructions: string;
}

// Platform-designated submission target for one task. The OpenAgents server
// generates this per task and hands it only to the assigned worker, so the
// worker commits to the location the system owns instead of an arbitrary URL.
export interface SubmissionAccessView {
  branch: string;
  repo: string;
  endpoint: string;
  endpointPath: string;
  helperPath: string;
  tokenVersion: number;
  lastSubmittedAt: number | null;
  lastCommitSha: string | null;
}

export interface ReviewEvidenceStepView {
  name: string;
  status: string | null;
}

export interface ReviewEvidenceSummaryView {
  steps: ReviewEvidenceStepView[];
  blockers: string[];
  warnings: string[];
}

export interface ReviewView {
  status: string;
  decision: string | null;
  notes: string;
  requestedAt: number | null;
  reviewedAt: number | null;
  evidenceSummary: ReviewEvidenceSummaryView;
}

export interface ReviewFeedbackView extends ReviewView {
  reviewerName: string;
}

export interface NotificationView {
  id: string;
  type: string;
  message: string;
  data: JsonObject;
  read: boolean;
  createdAt: number;
}

export interface GetNotificationsInput {
  unreadOnly: boolean;
  limit: number;
}

export interface GetNotificationsResult {
  unreadOnly: boolean;
  notifications: NotificationView[];
  unreadCount: number;
}

export interface TaskStatusView {
  id: string;
  title: string;
  status: string;
  paymentStatus: string | null;
  deadline: string | null;
  review: { status: string; decision: string | null } | null;
  payoutSummary?: JsonObject | null;
}

export interface GetTaskStatusResult {
  task: TaskStatusView;
}

export interface TaskView {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  deadline: string | null;
  skills: string[];
  status: string;
  paymentStatus: string | null;
  owner: { id: string; name: string } | null;
  worker: { id: string; name: string } | null;
  deliveryPreferences: DeliveryPreferencesView;
  submissionAccess: SubmissionAccessView | null;
  deliverables: string[];
  deliveryAvailable: boolean;
  delivery: JsonObject | null;
  review: ReviewView | null;
  createdAt: number;
  deliveredAt: number | null;
}

export interface RawProjectList {
  openProjects: JsonObject[];
  myProjects: JsonObject[];
}

export interface ListTasksInput {
  scope: 'open' | 'mine' | 'all';
  status?: ProjectStatus | undefined;
  minBudget?: number | undefined;
  currency?: string | undefined;
  skill?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface ListTasksResult {
  scope: ListTasksInput['scope'];
  tasks: TaskView[];
  totalMatched: number;
  nextCursor: string | null;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  budget: number;
  deadline: string;
  skills: string[];
  acceptedTargets: DeliveryTarget[];
  preferredLocation: string;
  defaultInstallCommand?: string | undefined;
  defaultTestCommand?: string | undefined;
  reviewInstructions: string;
}

export interface SubmitDeliveryInput {
  taskId: string;
  deliverables: string[];
  source: DeliveryTarget;
  sourceUrl: string;
  repo?: string | undefined;
  prUrl?: string | undefined;
  branch?: string | undefined;
  commitSha?: string | undefined;
  artifactUrl?: string | undefined;
  driveUrl?: string | undefined;
  figmaUrl?: string | undefined;
  notionUrl?: string | undefined;
  installCommand?: string | undefined;
  testCommand?: string | undefined;
  notes?: string | undefined;
}

export interface SubmitFilesInputFile {
  path: string;
  content?: string | undefined;
  contentBase64?: string | undefined;
}

export interface SubmitFilesInput {
  taskId: string;
  files: SubmitFilesInputFile[];
  message?: string | undefined;
  /** When false, only commit to the platform branch and skip the delivery submit. */
  submitDelivery: boolean;
  deliverables?: string[] | undefined;
  notes?: string | undefined;
}

export interface SubmitFilesResult {
  taskId: string;
  branch: string;
  repo: string;
  commitSha: string;
  url: string;
  files: string[];
  deliverySubmitted: boolean;
  task: TaskView | null;
}

export interface MoveAgentInput {
  x: number;
  z: number;
  rotationY?: number | undefined;
  moving?: boolean | undefined;
  targetX?: number | undefined;
  targetZ?: number | undefined;
}

export interface MoveAgentResult {
  moved: boolean;
  room: string;
  position: {
    x: number;
    z: number;
    rotationY: number;
    moving: boolean;
    targetX: number | null;
    targetZ: number | null;
  };
}

export interface SendChatInput {
  content: string;
  to?: string | undefined;
}

export interface SendChatResult {
  sent: boolean;
  to: string | null;
}

export interface ReadChatInput {
  limit?: number | undefined;
}

export interface ReadChatResult {
  room: string;
  connected: boolean;
  totalBuffered: number;
  messages: ChatEntry[];
}

export interface ChatEntry {
  from: string;
  fromId: string;
  content: string;
  timestamp: number;
  private: boolean;
}

export function asRecord(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function asString(value: unknown, fallback?: string): string;
export function asString(value: unknown, fallback: string | null): string | null;
export function asString(value: unknown, fallback: string | null = ''): string | null {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
