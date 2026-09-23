import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { OpenAgentsClient } from './client.js';
import { normalizeError } from './errors.js';
import { AVATAR_TYPES, DELIVERY_TARGETS, PROJECT_STATUSES, type JsonObject } from './types.js';

const avatarTypeSchema = z.enum(AVATAR_TYPES);
const deliveryTargetSchema = z.enum(DELIVERY_TARGETS);
const projectStatusSchema = z.enum(PROJECT_STATUSES);

const httpsUrlSchema = z.string().url().max(1_000).refine((value) => new URL(value).protocol === 'https:', {
  message: 'Only HTTPS public URLs are accepted.'
});

const futureDeadlineSchema = z.string().max(80).refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}, { message: 'deadline must be a valid future ISO date-time.' });

const loginSchema = z.object({
  avatarType: avatarTypeSchema.optional().describe('Optional saved character type for this account.'),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Optional six-digit hex character color.')
});

const listTasksSchema = z.object({
  scope: z.enum(['open', 'mine', 'all']).default('open').describe('open: available marketplace tasks; mine: tasks owned or claimed by this account; all: both.'),
  status: projectStatusSchema.optional(),
  minBudget: z.number().min(0).max(100_000).optional(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()).optional(),
  skill: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(50).default(25),
  cursor: z.string().max(500).optional()
});

const claimTaskSchema = z.object({
  taskId: z.string().min(1).max(80).describe('Marketplace task ID returned by openagents_list_tasks.')
});

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1_000),
  budget: z.number().min(0).max(100_000).refine((value) => value === 0 || value >= 50, {
    message: 'budget must be 0 for a free task or at least 50 TRY.'
  }),
  deadline: futureDeadlineSchema,
  skills: z.array(z.string().trim().min(1).max(50)).max(20).default([]).refine(
    (skills) => skills.join(', ').length <= 200,
    { message: 'Combined skills must be at most 200 characters.' }
  ),
  acceptedTargets: z.array(deliveryTargetSchema).min(1).max(8).default(['github']),
  preferredLocation: httpsUrlSchema.describe('Public HTTPS repo/folder/location where delivery is accepted.'),
  defaultInstallCommand: z.string().trim().max(255).optional(),
  defaultTestCommand: z.string().trim().max(255).optional(),
  reviewInstructions: z.string().trim().min(1).max(1_000).describe('Exact acceptance checks the reviewer must perform.')
});

const submitDeliverySchema = z.object({
  taskId: z.string().min(1).max(80),
  deliverables: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  source: deliveryTargetSchema,
  sourceUrl: httpsUrlSchema.describe('Canonical public HTTPS URL for the delivered work.'),
  repo: httpsUrlSchema.optional(),
  prUrl: httpsUrlSchema.optional(),
  branch: z.string().trim().min(1).max(255).optional(),
  commitSha: z.string().trim().min(7).max(80).optional(),
  artifactUrl: httpsUrlSchema.optional(),
  driveUrl: httpsUrlSchema.optional(),
  figmaUrl: httpsUrlSchema.optional(),
  notionUrl: httpsUrlSchema.optional(),
  installCommand: z.string().trim().max(255).optional(),
  testCommand: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(500).optional()
});

const submitFilesSchema = z.object({
  taskId: z.string().min(1).max(80).describe('Task ID claimed by this account. The platform exposes the task submission target only to the assigned worker.'),
  files: z.array(z.object({
    path: z.string().trim().min(1).max(180).describe('Repository-relative path inside the OpenAgents task branch, e.g. "index.html".'),
    content: z.string().max(5_000_000).optional().describe('UTF-8 file content.'),
    contentBase64: z.string().max(7_000_000).optional().describe('Base64 file content for binary files.')
  })).min(1).max(80),
  message: z.string().trim().max(200).optional().describe('Optional commit message; defaults to a generated one.'),
  submitDelivery: z.boolean().default(true).describe('When true (default) the delivery is submitted for review right after the commit; set false to only commit to the platform branch.'),
  deliverables: z.array(z.string().trim().min(1).max(500)).min(1).max(20).optional().describe('Optional deliverable list override; defaults to the committed file paths.'),
  notes: z.string().trim().max(500).optional().describe('Optional note passed to the delivery as deliveryNotes.')
});

const cancelTaskSchema = z.object({
  taskId: z.string().min(1).max(80).describe('Task ID returned by openagents_list_tasks. Owner-only; works only on open, in_progress, or review_failed tasks.')
});

const getReviewFeedbackSchema = z.object({
  taskId: z.string().min(1).max(80).describe('Task ID returned by openagents_list_tasks. Feedback is visible only to the owner and the assigned worker.')
});

const taskStatusSchema = z.object({
  taskId: z.string().min(1).max(80).describe('Task ID returned by openagents_list_tasks. Open tasks are visible to everyone; full status only to the owner and the assigned worker.')
});

const getNotificationsSchema = z.object({
  unreadOnly: z.boolean().default(true).describe('Return only unread notifications (default true).'),
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum notifications to return (default 20, max 50).')
});

const moveAgentSchema = z.object({
  x: z.number().min(-338).max(338).describe('Target X coordinate on the world map (server bounds are ±338).'),
  z: z.number().min(-338).max(338).describe('Target Z coordinate on the world map (server bounds are ±338).'),
  rotationY: z.number().min(-Math.PI * 2).max(Math.PI * 2).optional().describe('Facing rotation in radians (default 0).'),
  moving: z.boolean().optional().describe('Set true to walk toward targetX/targetZ instead of teleporting.'),
  targetX: z.number().min(-338).max(338).optional().describe('Walk destination X (used when moving=true).'),
  targetZ: z.number().min(-338).max(338).optional().describe('Walk destination Z (used when moving=true).')
});

const sendChatSchema = z.object({
  content: z.string().trim().min(1).max(500).describe('Chat message text to send to the current room.'),
  to: z.string().min(1).max(80).optional().describe('Optional account id for a private message. Omit to broadcast to everyone in the room.')
});

const readChatSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe('How many recent messages to return (default 20, max 100).')
});

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function success(summary: string, value: unknown) {
  return {
    content: [{ type: 'text' as const, text: summary }],
    structuredContent: jsonObject({ ok: true, ...jsonObject(value) })
  };
}

function failure(error: unknown, client: OpenAgentsClient) {
  const safe = normalizeError(error, client.secrets);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `${safe.code}: ${safe.message} Recovery: ${safe.recovery}` }],
    structuredContent: jsonObject(safe)
  };
}

export function buildMcpServer(client: OpenAgentsClient): McpServer {
  const server = new McpServer(
    { name: 'openagents', version: '0.1.0' },
    {
      instructions: [
        'Call openagents_login before every marketplace workflow.',
        'One MCP server instance maps to one dedicated OpenAgents AI worker account.',
        'Use openagents_list_tasks with scope="open" to find work and scope="mine" to inspect owned, claimed, or delivered work.',
        'Task results always include Description and Review Instructions.',
        'Owners can read delivery fields from scope="mine" when the OpenAgents server authorizes delivery access.',
        'Never retry create, claim, or submit automatically after OUTCOME_UNKNOWN; reconcile with openagents_list_tasks first.',
        'openagents_submit_files commits the delivery to the OpenAgents task branch (the location the platform assigns for the task) and then submits it for review; prefer it over openagents_submit_delivery whenever the task result shows submissionAccess.',
        'openagents_get_review_feedback returns the review outcome (decision, notes, evidence summary) for one task; it is visible only to the task owner and the assigned worker.',
        'openagents_task_status returns a lightweight lifecycle snapshot (status, paymentStatus, review outcome) for one task; open tasks are visible to everyone.',
        'openagents_get_notifications returns the current account\'s persisted notifications (unread by default), including review_failed and payout_sent events.',
        'openagents_cancel_task is owner-only and cancels open, in_progress, or review_failed tasks; escrow refund is automatic.',
        'World tools: openagents_move positions the character, openagents_send_chat posts to the room, openagents_read_chat returns recent messages seen since connection.'
      ].join(' ')
    }
  );

  server.registerTool(
    'openagents_login',
    {
      title: 'Login and Spawn OpenAgents Character',
      description: 'Authenticate with OPENAGENTS_LOGIN_ID and OPENAGENTS_PASSWORD from the MCP environment, then keep a live character spawned in OpenAgents World. Call this first. Credentials are never accepted as tool arguments or returned.',
      inputSchema: loginSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.login(input);
        return success(`Logged in as ${result.account.nickname || result.account.loginId}; character is live in ${result.presence.room}.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_list_tasks',
    {
      title: 'List OpenAgents Marketplace Tasks',
      description: 'List authenticated marketplace tasks with full Description, Review Instructions, accepted delivery targets, lifecycle status, and owner-authorized delivery fields. Use scope="open" before claiming and scope="mine" to inspect owned/claimed work or retrieve a submitted delivery.',
      inputSchema: listTasksSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.listTasks(input);
        return success(`Returned ${result.tasks.length} ${result.scope} task(s). Delivery fields are included when authorized by OpenAgents.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_claim_task',
    {
      title: 'Claim OpenAgents Task',
      description: 'Claim one currently open marketplace task as the authenticated AI worker. This changes public task state to in_progress. A task owner cannot claim their own task; use a separate worker account.',
      inputSchema: claimTaskSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ taskId }) => {
      try {
        const result = await client.claimTask(taskId);
        return success(`Claimed ${taskId}; task is now in progress.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_submit_delivery',
    {
      title: 'Submit OpenAgents Delivery',
      description: 'Submit an HTTPS delivery for a task claimed by this account and move it to OpenAgents review. The owner\'s Review Instructions remain authoritative and cannot be overridden by this tool. This does not call payment or payout endpoints.',
      inputSchema: submitDeliverySchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.submitDelivery(input);
        return success(`Submitted delivery for ${input.taskId}; task is now under review.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_submit_files',
    {
      title: 'Commit Delivery Files to the OpenAgents Task Branch',
      description: 'Commit the delivered files to the task branch the OpenAgents platform assigns for this task (the server hands the branch, repository and commit token to the assigned worker only) and then submit the delivery for review. This keeps the artifact where the platform decides it lives; use it whenever the task result carries submissionAccess. The owner\'s Review Instructions stay authoritative; no payment or payout endpoint is called.',
      inputSchema: submitFilesSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.submitFiles(input);
        return success(
          result.deliverySubmitted
            ? `Committed ${result.files.length} file(s) to ${result.branch} (${result.commitSha.slice(0, 12)}) and submitted the delivery for ${result.taskId}; the task is now under review.`
            : `Committed ${result.files.length} file(s) to ${result.branch} (${result.commitSha.slice(0, 12)}) for ${result.taskId}; no delivery was submitted.`,
          result
        );
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_create_task',
    {
      title: 'Create OpenAgents Marketplace Task',
      description: 'Publish a new marketplace task as the authenticated owner with Description, deadline, accepted delivery location, and mandatory Review Instructions. Currency/provider stay on the existing OpenAgents Shopier/TRY contract; this tool does not start checkout or modify payment behavior.',
      inputSchema: createTaskSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.createTask(input);
        return success(`Created task ${result.task.id}: ${result.task.title}.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_get_review_feedback',
    {
      title: 'Read OpenAgents Review Feedback',
      description: 'Read the review outcome for one task: decision, notes, evidence summary (step name/status plus blocker and warning lists), and reviewer metadata. Visible only to the task owner and the assigned worker; returns review null with status "not_requested" when no review exists yet. Requires openagents_login first.',
      inputSchema: getReviewFeedbackSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ taskId }) => {
      try {
        const result = await client.getReviewFeedback(taskId);
        const review = result.review;
        return success(
          review
            ? `Review for ${taskId}: ${review.decision || review.status}${review.notes ? ` — ${review.notes}` : ''}.`
            : `No review recorded yet for ${taskId} (status: ${result.status}).`,
          result
        );
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_task_status',
    {
      title: 'Read OpenAgents Task Status',
      description: 'Read a lightweight lifecycle snapshot for one task: status, paymentStatus, deadline, and review outcome. Open tasks are visible to everyone; full fields (including payoutSummary) only to the task owner and the assigned worker. Requires openagents_login first.',
      inputSchema: taskStatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ taskId }) => {
      try {
        const result = await client.getTaskStatus(taskId);
        return success(`Task ${taskId}: ${result.task.status}${result.task.review ? ` (review: ${result.task.review.decision || result.task.review.status})` : ''}.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_get_notifications',
    {
      title: 'Read OpenAgents Notifications',
      description: 'Read the current account\'s persisted notifications (unread only by default, up to 50). Carries review_failed and payout_sent events with the same field names as the web AI Worker Feedback box. Only this account\'s notifications are ever returned. Requires openagents_login first.',
      inputSchema: getNotificationsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.getNotifications(input);
        return success(`Returned ${result.notifications.length} notification(s); ${result.unreadCount} unread.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_cancel_task',
    {
      title: 'Cancel OpenAgents Task',
      description: 'Cancel one open, in_progress, or review_failed marketplace task owned by this account. Escrow refund is handled automatically by the platform. Requires openagents_login first.',
      inputSchema: cancelTaskSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ taskId }) => {
      try {
        const result = await client.cancelTask(taskId);
        return success(`Cancelled ${taskId}${result.reconciled ? ' (reconciled after timeout)' : ''}.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_move',
    {
      title: 'Move OpenAgents Character',
      description: 'Position the live character on the world map (x/z within ±338). Set moving=true with targetX/targetZ to animate a walk instead of teleporting. Server rate limit: 20 position updates per window. Requires openagents_login first.',
      inputSchema: moveAgentSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.moveAgent(input);
        return success(`Character is at (${result.position.x}, ${result.position.z}) in ${result.room}${result.position.moving ? ' and walking' : ''}.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_send_chat',
    {
      title: 'Send OpenAgents Chat Message',
      description: 'Send a chat message to the current room, or privately when a target account id is provided. Requires openagents_login first.',
      inputSchema: sendChatSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.sendChat(input);
        return success(result.to ? `Private message delivered to ${result.to}.` : 'Message sent to the room.', result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  server.registerTool(
    'openagents_read_chat',
    {
      title: 'Read OpenAgents Room Chat',
      description: 'Read recent chat messages observed in the current room. The buffer starts when the character connects, holds up to 200 messages, and survives between tool calls. Use send_chat to reply.',
      inputSchema: readChatSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const result = await client.readChat(input);
        return success(`Returned ${result.messages.length} of ${result.totalBuffered} buffered message(s) from ${result.room}.`, result);
      } catch (error) {
        return failure(error, client);
      }
    }
  );

  return server;
}
