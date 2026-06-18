import React from 'react';

import { TanaClient, type Workspace } from '../tana/client';
import {
  CATALOG_BY_KEY,
  DEFAULT_TAG_NAME,
  effectiveFieldName,
  type TanaDataType,
} from '../tana/constants';
import { ensureSchema } from '../tana/schema';
import { logger } from '../utils';

import {
  getSchemaConfig,
  setSchemaConfig,
  type FieldConfig,
  type SchemaConfig,
} from './schema-config';
import { ZotanaPref, getZotanaPref, setZotanaPref } from './zotana-pref';

type StatusKind = 'idle' | 'busy' | 'ok' | 'error';

type State = {
  config: SchemaConfig;
  workspaces: Workspace[];
  workspaceId: string;
  statusKind: StatusKind;
  statusMessage: string;
};

/** Friendly label for each Tana data type shown beside a field. */
const DATA_TYPE_LABEL: Record<TanaDataType, string> = {
  plain: 'Text',
  number: 'Number',
  date: 'Date',
  url: 'URL',
  email: 'Email',
  checkbox: 'Checkbox',
  user: 'User',
  instance: 'Reference',
  options: 'Options',
};

const STATUS_COLOR: Record<StatusKind, string> = {
  idle: 'inherit',
  busy: 'inherit',
  ok: '#1a7f37',
  error: '#cf222e',
};

/**
 * Preferences UI for the Tana schema: pick the workspace, name the reference tag
 * and each field, choose which fields sync, and create/refresh the tag + fields
 * in Tana. Field NAMES are the source of truth; IDs are resolved (or created) at
 * sync time, so renaming here (and in Tana) keeps the link working.
 */
export class SchemaPanel extends React.Component<unknown, State> {
  public constructor(props: unknown) {
    super(props);
    this.state = {
      config: getSchemaConfig(),
      workspaces: [],
      workspaceId: getZotanaPref(ZotanaPref.tanaWorkspaceId) ?? '',
      statusKind: 'idle',
      statusMessage: '',
    };
  }

  public componentDidMount(): void {
    void this.loadWorkspaces();
  }

  /** Build a client from the saved token, or null when no token is set yet. */
  private buildClient(): TanaClient | null {
    const token = getZotanaPref(ZotanaPref.tanaToken);
    if (!token) return null;
    return new TanaClient({
      token,
      baseUrl: getZotanaPref(ZotanaPref.tanaBaseUrl),
      fetch: window.fetch.bind(window),
    });
  }

  private async loadWorkspaces(): Promise<void> {
    const client = this.buildClient();
    if (!client) return;
    try {
      const workspaces = await client.listWorkspaces();
      this.setState((prev) => ({
        workspaces,
        // Default to the first workspace when none is chosen yet.
        workspaceId: prev.workspaceId || workspaces[0]?.id || '',
      }));
    } catch (error) {
      logger.error('Failed to list Tana workspaces', error);
    }
  }

  private persistConfig(config: SchemaConfig): void {
    setSchemaConfig(config);
    this.setState({ config });
  }

  private handleWorkspaceChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const workspaceId = event.target.value;
    setZotanaPref(ZotanaPref.tanaWorkspaceId, workspaceId);
    this.setState({ workspaceId });
  };

  private handleTagNameChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    this.persistConfig({ ...this.state.config, tagName: event.target.value });
  };

  private updateField(key: string, patch: Partial<FieldConfig>): void {
    const fields = this.state.config.fields.map((field) =>
      field.key === key ? { ...field, ...patch } : field,
    );
    this.persistConfig({ ...this.state.config, fields });
  }

  private handleCreateRefresh = async (): Promise<void> => {
    const client = this.buildClient();
    if (!client) {
      this.setStatus('error', 'Set your Tana API token first.');
      return;
    }
    if (!this.state.workspaceId) {
      this.setStatus('error', 'Pick a workspace first.');
      return;
    }

    // Persist the current names/tag before creating. Blank names are kept blank
    // (resolved to the catalog default at sync time); only the tag name and real
    // renames are normalized here.
    const config = normalizeConfig(this.state.config);
    this.persistConfig(config);

    this.setStatus('busy', 'Creating / refreshing schema in Tana…');
    try {
      const schema = await ensureSchema(client, config, {
        workspaceId: this.state.workspaceId,
        optionSeeds: { itemType: zoteroItemTypeNames() },
      });
      const count = Object.keys(schema.fields).length;
      this.setStatus(
        'ok',
        `Ready: #${schema.tagName} with ${count} field${count === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      logger.error('Failed to create/refresh Tana schema', error);
      this.setStatus('error', `Failed: ${describeError(error)}`);
    }
  };

  private setStatus(statusKind: StatusKind, statusMessage: string): void {
    this.setState({ statusKind, statusMessage });
  }

  public render(): React.ReactNode {
    const { config, workspaces, workspaceId, statusKind, statusMessage } =
      this.state;

    return (
      <div className="zotana-schema-panel">
        <div className="zotana-margin-block-start">
          <label htmlFor="zotana-schema-workspace">Workspace: </label>
          <select
            id="zotana-schema-workspace"
            value={workspaceId}
            onChange={this.handleWorkspaceChange}
          >
            {!workspaceId && <option value="">Select a workspace…</option>}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name ?? workspace.id}
              </option>
            ))}
          </select>
        </div>

        <div className="zotana-margin-block-start">
          <label htmlFor="zotana-schema-tagName">Reference tag name: </label>
          <span aria-hidden="true">#</span>
          <input
            id="zotana-schema-tagName"
            type="text"
            value={config.tagName}
            onChange={this.handleTagNameChange}
          />
        </div>

        <table className="zotana-schema-table zotana-margin-block-start">
          <thead>
            <tr>
              <th>Sync</th>
              <th>Field name</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {config.fields.map((field) => (
              <tr key={field.key}>
                <td>
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    aria-label={`Sync ${effectiveFieldName(field.key, field.name)}`}
                    onChange={(event) =>
                      this.updateField(field.key, {
                        enabled: event.target.checked,
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={field.name}
                    disabled={!field.enabled}
                    placeholder={CATALOG_BY_KEY[field.key].defaultName}
                    onChange={(event) =>
                      this.updateField(field.key, { name: event.target.value })
                    }
                  />
                </td>
                <td>{DATA_TYPE_LABEL[CATALOG_BY_KEY[field.key].dataType]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="zotana-margin-block-start">
          <button type="button" onClick={() => void this.handleCreateRefresh()}>
            Create / refresh schema in Tana
          </button>
          {statusMessage && (
            <span
              className="zotana-schema-status"
              style={{ color: STATUS_COLOR[statusKind], marginInlineStart: 8 }}
            >
              {statusMessage}
            </span>
          )}
        </div>
      </div>
    );
  }
}

/** Normalize the tag name and trim field names; blank names stay blank. */
function normalizeConfig(config: SchemaConfig): SchemaConfig {
  return {
    tagName: config.tagName.trim() || DEFAULT_TAG_NAME,
    fields: config.fields.map((field) => ({
      ...field,
      name: field.name.trim(),
    })),
  };
}

/** Localized names of all Zotero item types, to seed the Item Type options field. */
function zoteroItemTypeNames(): string[] {
  try {
    return Zotero.ItemTypes.getTypes().map((type) =>
      Zotero.ItemTypes.getLocalizedString(type.id),
    );
  } catch {
    return [];
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
