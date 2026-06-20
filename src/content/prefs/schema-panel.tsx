import React from 'react';

import { TanaClient, type Workspace } from '../tana/client';
import {
  ANNOTATION_TAG_KEYS,
  ANNOTATION_TAG_NAMES,
  CATALOG_BY_KEY,
  DEFAULT_TAG_NAME,
  ENTITY_TAG_KEYS,
  ENTITY_TAG_NAMES,
  effectiveFieldName,
  type AnnotationKind,
  type EntityTag,
  type TanaDataType,
} from '../tana/constants';
import { ensureSchema } from '../tana/schema';
import { logger } from '../utils';

import {
  defaultSchemaConfig,
  getSchemaConfig,
  setSchemaConfig,
  type FieldConfig,
  type SchemaConfig,
} from './schema-config';
import {
  PageTitleFormat,
  ZotanaPref,
  getZotanaPref,
  setZotanaPref,
} from './zotana-pref';

/** One selectable entry in the reference-node-title dropdown. */
export type TitleFormatOption = {
  value: PageTitleFormat;
  label: string;
  disabled: boolean;
};

type Props = {
  /** Resolved (localized) options for the reference-node-title dropdown. */
  titleFormatOptions: TitleFormatOption[];
};

type StatusKind = 'idle' | 'busy' | 'ok' | 'error';

type State = {
  config: SchemaConfig;
  workspaceId: string;
  /** Workspaces fetched by Detect, shown in the picker. Empty until clicked. */
  workspaces: Workspace[];
  titleFormat: PageTitleFormat;
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
export class SchemaPanel extends React.Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    this.state = {
      config: getSchemaConfig(),
      workspaceId: getZotanaPref(ZotanaPref.tanaWorkspaceId) ?? '',
      workspaces: [],
      titleFormat:
        getZotanaPref(ZotanaPref.pageTitleFormat) ??
        PageTitleFormat.itemAuthorDateCitation,
      statusKind: 'idle',
      statusMessage: '',
    };
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

  /** Persist and reflect a workspace ID chosen via the input or Detect. */
  private applyWorkspaceId(workspaceId: string): void {
    setZotanaPref(ZotanaPref.tanaWorkspaceId, workspaceId);
    this.setState({ workspaceId });
  }

  private handleWorkspaceIdChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    this.applyWorkspaceId(event.target.value.trim());
  };

  /** Picking a workspace copies its ID into the (source-of-truth) text field. */
  private handleWorkspaceSelect = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    const id = event.target.value;
    if (id) this.applyWorkspaceId(id);
  };

  /**
   * Populate the workspace picker from `GET /workspaces`. Run on demand (not at
   * mount) so it reflects the current token and a running Tana — fixing the old
   * dropdown's load-once staleness. Requires the account-level Personal Access
   * Token (the only token the Local API accepts); a workspace/Input-API token
   * 401s here. Sync never calls this — it requires the configured ID outright.
   */
  private handleDetect = async (): Promise<void> => {
    const client = this.buildClient();
    if (!client) {
      this.setStatus('error', 'Set your Tana API token first.');
      return;
    }

    this.setStatus('busy', 'Detecting workspaces…');
    try {
      const workspaces = await client.listWorkspaces();
      this.setState({ workspaces });
      const only = workspaces.length === 1 ? workspaces[0] : undefined;
      if (only) {
        this.applyWorkspaceId(only.id);
        this.setStatus('ok', `Found workspace ${only.name ?? only.id}.`);
      } else if (workspaces.length > 1) {
        this.setStatus('ok', 'Pick a workspace from the list.');
      } else {
        this.setStatus(
          'error',
          'No workspaces for this token. Use an account-level Personal Access Token.',
        );
      }
    } catch (error) {
      logger.error('Failed to detect Tana workspace', error);
      this.setStatus('error', `Detect failed: ${describeError(error)}`);
    }
  };

  private persistConfig(config: SchemaConfig): void {
    setSchemaConfig(config);
    this.setState({ config });
  }

  private updateEntityTag(key: EntityTag, name: string): void {
    this.persistConfig({
      ...this.state.config,
      entityTags: { ...this.state.config.entityTags, [key]: name },
    });
  }

  private updateAnnotationTag(key: AnnotationKind, name: string): void {
    this.persistConfig({
      ...this.state.config,
      annotationTags: { ...this.state.config.annotationTags, [key]: name },
    });
  }

  private handleTitleFormatChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const titleFormat = event.target.value as PageTitleFormat;
    setZotanaPref(ZotanaPref.pageTitleFormat, titleFormat);
    this.setState({ titleFormat });
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
      this.setStatus('error', 'Enter a workspace ID first.');
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

  /** A labelled `#tag` name input (shared by the reference + aux tag rows). */
  private renderTagNameInput(
    id: string,
    label: string,
    value: string,
    placeholder: string,
    onChange: (name: string) => void,
  ): React.ReactNode {
    return (
      <div className="zotana-margin-block-start" key={id}>
        <label htmlFor={id}>{label}: </label>
        <span aria-hidden="true">#</span>
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  public render(): React.ReactNode {
    const {
      config,
      workspaceId,
      workspaces,
      titleFormat,
      statusKind,
      statusMessage,
    } = this.state;

    // The dropdown reflects the text field only when the ID is one Detect found;
    // a manually-typed ID leaves it on the placeholder without a phantom option.
    const selectValue = workspaces.some((ws) => ws.id === workspaceId)
      ? workspaceId
      : '';

    return (
      <div className="zotana-schema-panel">
        <div className="zotana-margin-block-start">
          <label htmlFor="zotana-schema-workspace">Workspace ID: </label>
          <input
            id="zotana-schema-workspace"
            type="text"
            value={workspaceId}
            placeholder="Workspace ID"
            onChange={this.handleWorkspaceIdChange}
          />
          <button
            type="button"
            style={{ marginInlineStart: 8 }}
            onClick={() => void this.handleDetect()}
          >
            Detect
          </button>
          {workspaces.length > 0 && (
            <select
              aria-label="Pick a workspace"
              style={{ marginInlineStart: 8 }}
              value={selectValue}
              onChange={this.handleWorkspaceSelect}
            >
              <option value="">Pick a workspace…</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name ?? ws.id}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Names of every other supertag Zotana creates. */}
        {ENTITY_TAG_KEYS.map((key) =>
          this.renderTagNameInput(
            `zotana-schema-entityTag-${key}`,
            `${capitalize(key)} tag name`,
            config.entityTags[key],
            ENTITY_TAG_NAMES[key],
            (name) => this.updateEntityTag(key, name),
          ),
        )}
        {ANNOTATION_TAG_KEYS.map((key) =>
          this.renderTagNameInput(
            `zotana-schema-annotationTag-${key}`,
            `${capitalize(key)} tag name`,
            config.annotationTags[key],
            ANNOTATION_TAG_NAMES[key],
            (name) => this.updateAnnotationTag(key, name),
          ),
        )}

        {this.renderTagNameInput(
          'zotana-schema-tagName',
          'Reference tag name',
          config.tagName,
          DEFAULT_TAG_NAME,
          (name) => this.persistConfig({ ...this.state.config, tagName: name }),
        )}

        <div className="zotana-margin-block-start">
          <label htmlFor="zotana-schema-titleFormat">
            Reference node title:{' '}
          </label>
          <select
            id="zotana-schema-titleFormat"
            value={titleFormat}
            onChange={this.handleTitleFormatChange}
          >
            {this.props.titleFormatOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
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

/** Trim each tag name, falling back to its default when left blank. */
function normalizeTagNames<K extends string>(
  keys: readonly K[],
  names: Record<K, string>,
  fallback: Record<K, string>,
): Record<K, string> {
  const result = { ...names };
  for (const key of keys) {
    result[key] = result[key].trim() || fallback[key];
  }
  return result;
}

/**
 * Normalize tag names (blank → the catalog/constant default) and trim field
 * names (blank field names stay blank, resolved to the default at sync time).
 */
function normalizeConfig(config: SchemaConfig): SchemaConfig {
  const defaults = defaultSchemaConfig();
  return {
    tagName: config.tagName.trim() || DEFAULT_TAG_NAME,
    entityTags: normalizeTagNames(
      ENTITY_TAG_KEYS,
      config.entityTags,
      defaults.entityTags,
    ),
    annotationTags: normalizeTagNames(
      ANNOTATION_TAG_KEYS,
      config.annotationTags,
      defaults.annotationTags,
    ),
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

/** Capitalize the first letter (for the aux tag labels, e.g. "highlight"). */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
