/**
 * Thin REST client for the Tana Local API (http://localhost:8262).
 *
 * The Tana desktop app exposes the SAME operations over two façades: an `/mcp`
 * endpoint for AI clients (Claude Code, Cursor) and a plain REST API. A Zotero
 * plugin wants REST, so this wraps it directly — no MCP protocol ceremony.
 *
 * Endpoint shapes were taken from the server's own /openapi.json ("Tana Local
 * API" v1.0.0). The app must be running with the Local API enabled and the target
 * workspace loaded; otherwise requests fail (use `health()` to preflight).
 *
 * `fetch` is injected so the plugin can pass the Zotero window's fetch.
 */

export interface TanaClientOptions {
  /** Personal API token (per workspace) from Tana → Settings → API Tokens. */
  token: string;
  /** Override the base URL. Default: http://localhost:8262 */
  baseUrl?: string;
  /** fetch implementation (default: global fetch). */
  fetch?: typeof globalThis.fetch;
}

export interface CreatedNode {
  id: string;
  name: string;
}

export interface ImportResult {
  parentNodeId: string;
  targetNodeId: string;
  /** The tagged node has the visible name; field-value nodes come back empty-named. */
  createdNodes: CreatedNode[];
  message: string;
}

export interface SearchNode {
  id: string;
  name: string;
  breadcrumb: string[];
  tags: { id: string; name: string }[];
  tagIds: string[];
  workspaceId: string;
  docType: string;
  description?: string;
  created: string;
  inTrash: boolean;
}

export interface ReadResult {
  markdown: string;
  name?: string;
  description?: unknown;
}

export type FieldMode = 'replace' | 'append';

export interface Workspace {
  id: string;
  name?: string;
  homeNodeId?: string;
}

export interface WorkspaceTag {
  id: string;
  name: string;
  color?: string;
}

/** Tana field data types accepted by `POST /tags/{tagId}/fields`. */
export type FieldDataType =
  | 'plain'
  | 'number'
  | 'date'
  | 'url'
  | 'email'
  | 'checkbox'
  | 'user'
  | 'instance'
  | 'options';

export interface CreateFieldOptions {
  name: string;
  dataType: FieldDataType;
  description?: string;
  /** Required when dataType is 'instance' — the tag instances reference. */
  sourceTagId?: string;
  /** Required (non-empty) when dataType is 'options'. */
  options?: string[];
  isMultiValue?: boolean;
}

export interface CreateTagResult {
  tagId: string;
  tagName: string;
  message: string;
}

export interface CreateFieldResult {
  tagId: string;
  fieldId: string;
  fieldName: string;
  dataType: string;
  message: string;
}

/** Thrown for non-2xx responses, carrying the HTTP status and raw body. */
export class TanaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'TanaApiError';
  }
}

const DEFAULT_BASE_URL = 'http://localhost:8262';

export class TanaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: typeof globalThis.fetch;

  public constructor({ token, baseUrl, fetch: fetchFn }: TanaClientOptions) {
    this.token = token;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  /** True if the server is up and the node space is ready. No auth required. */
  public async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/health`);
      if (!res.ok) return false;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const json = (await res.json()) as {
        status?: string;
        nodeSpaceReady?: boolean;
      };
      return json.status === 'ok' && json.nodeSpaceReady !== false;
    } catch {
      return false;
    }
  }

  /** Create nodes from Tana Paste under a parent. Returns the created node IDs. */
  public import(parentNodeId: string, content: string): Promise<ImportResult> {
    return this.request('POST', `/nodes/${enc(parentNodeId)}/import`, {
      content,
    });
  }

  /**
   * Set (replace by default) a plain/url/date/number/text field's value, or pass
   * `content: null` to clear the field. The upsert primitive. For reference
   * fields the content is a node ID; for date fields, a bare ISO value.
   */
  public async setFieldContent(
    nodeId: string,
    attributeId: string,
    content: string | null,
    mode: FieldMode = 'replace',
  ): Promise<void> {
    await this.request(
      'POST',
      `/nodes/${enc(nodeId)}/fields/${enc(attributeId)}/content`,
      { content, mode },
    );
  }

  /**
   * Update a node's name and/or description. The REST `POST /nodes/{id}/update`
   * endpoint replaces each provided value outright (`null` clears it) and leaves
   * omitted fields untouched — not the search/replace shape the MCP `edit_node`
   * tool exposes. (Verified against the live server, 2026-06-17.)
   */
  public async update(
    nodeId: string,
    fields: { name?: string | null; description?: string | null },
  ): Promise<void> {
    await this.request('POST', `/nodes/${enc(nodeId)}/update`, fields);
  }

  /** Set an options field to a predefined option (e.g. Item Type). */
  public async setFieldOption(
    nodeId: string,
    attributeId: string,
    optionId: string,
    mode: FieldMode = 'replace',
  ): Promise<void> {
    await this.request(
      'POST',
      `/nodes/${enc(nodeId)}/fields/${enc(attributeId)}/option`,
      { optionId, mode },
    );
  }

  /** Add or remove supertags on a node. */
  public async setTags(
    nodeId: string,
    tagIds: string[],
    action: 'add' | 'remove' = 'add',
  ): Promise<void> {
    await this.request('POST', `/nodes/${enc(nodeId)}/tags`, {
      action,
      tagIds,
    });
  }

  /** Move a node to the workspace trash. */
  public async trash(nodeId: string): Promise<void> {
    await this.request('POST', `/nodes/${enc(nodeId)}/trash`, {});
  }

  /** Read a node (and children to maxDepth) as markdown. */
  public readNode(nodeId: string, maxDepth = 1): Promise<ReadResult> {
    return this.request('GET', `/nodes/${enc(nodeId)}`, undefined, {
      maxDepth,
    });
  }

  /**
   * Structured search (same query shape as the MCP search_nodes tool). The
   * `/nodes/search` endpoint serializes `query` and `workspaceIds` as OpenAPI
   * `deepObject` params — bracketed keys with LITERAL brackets (e.g.
   * `query[and][0][hasType]=…`), not a JSON string. URL query brackets are not
   * in the percent-encode set, so `fetch` leaves them intact. (Verified live.)
   */
  public search(
    query: object,
    opts: { workspaceIds?: string[]; limit?: number } = {},
  ): Promise<SearchNode[]> {
    const params = deepObjectParams('query', query);
    opts.workspaceIds?.forEach((id, index) => {
      params.push(`workspaceIds[${index}]=${encodeURIComponent(id)}`);
    });
    if (opts.limit) params.push(`limit=${opts.limit}`);

    return this.request('GET', `/nodes/search?${params.join('&')}`);
  }

  /** List the workspaces available to this token. */
  public listWorkspaces(): Promise<Workspace[]> {
    return this.request('GET', '/workspaces');
  }

  /** List the supertags defined in a workspace (used to resolve a tag by name). */
  public listWorkspaceTags(workspaceId: string): Promise<WorkspaceTag[]> {
    return this.request('GET', `/workspaces/${enc(workspaceId)}/tags`);
  }

  /** Create a new supertag in a workspace. */
  public createTag(
    workspaceId: string,
    options: { name: string; description?: string; extendsTagIds?: string[] },
  ): Promise<CreateTagResult> {
    return this.request(
      'POST',
      `/workspaces/${enc(workspaceId)}/tags`,
      options,
    );
  }

  /** Add a typed field to a supertag. Returns the new attribute ID. */
  public addField(
    tagId: string,
    options: CreateFieldOptions,
  ): Promise<CreateFieldResult> {
    return this.request('POST', `/tags/${enc(tagId)}/fields`, options);
  }

  /** Read a supertag's schema as markdown (field names + attribute IDs). */
  public async getTagSchema(tagId: string): Promise<string> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const result = (await this.request(
      'GET',
      `/tags/${enc(tagId)}/schema`,
    )) as { markdown?: string };
    return result.markdown ?? '';
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, string | number>,
    // The REST API is the untyped JSON boundary; callers assert the concrete
    // response shape. Keeping the gateway `any` avoids casts at every call site.
    // oxlint-disable-next-line typescript/no-explicit-any
  ): Promise<any> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ).toString();
      if (qs) url += `?${qs}`;
    }

    const res = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TanaApiError(
        res.status,
        text,
        `Tana Local API ${method} ${path} failed: ${res.status} ${res.statusText}`,
      );
    }

    if (res.status === 204) return undefined;
    return res.json();
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Serialize a value as OpenAPI `deepObject` query params: nested objects/arrays
 * become bracketed keys (`root[a][0][b]=…`). Brackets are left literal (the URL
 * query percent-encode set excludes them); only values are encoded.
 */
function deepObjectParams(rootKey: string, value: unknown): string[] {
  const pairs: string[] = [];

  const walk = (key: string, val: unknown): void => {
    if (Array.isArray(val)) {
      val.forEach((item, index) => walk(`${key}[${index}]`, item));
    } else if (val !== null && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) walk(`${key}[${k}]`, v);
    } else {
      pairs.push(`${key}=${encodeURIComponent(String(val))}`);
    }
  };

  walk(rootKey, value);
  return pairs;
}
