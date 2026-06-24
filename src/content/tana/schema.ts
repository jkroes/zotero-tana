/**
 * Resolves the user-configured schema (tag + field NAMES) to live Tana IDs,
 * creating the supertag and any missing enabled fields when they don't exist.
 *
 * IDs are workspace-specific and never hardcoded: every sync job resolves them
 * fresh from the names in `SchemaConfig`. A field/tag that already exists is
 * matched by name; one that doesn't is created with the data type the catalog
 * pins to that field. The result feeds the reference builder and sync engine.
 */

import type { SchemaConfig } from '../prefs/schema-config';

import { TanaClient } from './client';
import {
  ANNOTATION_FIELD_NAME,
  ANNOTATION_ORDER_FIELD_NAME,
  ANNOTATION_PAGE_FIELD_NAME,
  CATALOG_BY_KEY,
  REFERENCE_ANNOTATIONS_FIELD_NAME,
  effectiveFieldName,
  type AnnotationKind,
  type CatalogEntry,
  type EntityTag,
  type FieldKey,
} from './constants';

export type ResolvedField = { name: string; id: string };

/**
 * A resolved annotation supertag plus its `Annotation` back-link field id, its
 * `Page` field id, and its `Order` (reading-order rank) field id.
 */
export type ResolvedAnnotationTag = {
  tagId: string;
  annotationFieldId: string;
  pageFieldId: string;
  orderFieldId: string;
};

/**
 * Placeholder option used to satisfy the REST API's "options need ≥1 seed"
 * rule when creating an entity (Person/Org) options field. It is trashed right
 * after creation; the field keeps accepting reference writes without it.
 */
const SEED_OPTION_LABEL = '__zotana_seed__';

export type ResolvedSchema = {
  workspaceId: string;
  tagId: string;
  tagName: string;
  entityTagIds: Record<EntityTag, string>;
  /** Entity supertag NAMES (for inline `[[Name #Tag]]` refs in the paste). */
  entityTagNames: Record<EntityTag, string>;
  /** Annotation supertags (highlight/comment/image) + each one's link field id. */
  annotationTags: Record<AnnotationKind, ResolvedAnnotationTag>;
  /**
   * Attribute id of the reference tag's `Annotations` field, the container under
   * which annotation nodes are imported (see `REFERENCE_ANNOTATIONS_FIELD_NAME`).
   */
  annotationsFieldId: string;
  /** Enabled fields only: catalog key -> resolved name + attribute id. */
  fields: Partial<Record<FieldKey, ResolvedField>>;
  /**
   * Per options field, its predefined/known option values as `optionText ->
   * optionId`, keyed by attribute id. Lets sync write a value BY ID via
   * `setFieldOption` (reusing the existing option) instead of a string write that
   * would duplicate a pre-existing option. Empty for fields with no options yet.
   */
  optionsByFieldId: Map<string, Map<string, string>>;
};

export type EnsureSchemaOptions = {
  workspaceId: string;
  /** Per-field option seeds for options-typed fields (e.g. Item Type values). */
  optionSeeds?: Partial<Record<FieldKey, string[]>>;
};

/**
 * Parse `GET /tags/{id}/schema` markdown into a name->attributeId map. Lines look
 * like: `- **Field Name** (id:abc123):: Content`.
 */
export function parseTagSchemaFields(markdown: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    const match = /^\s*-\s*\*\*(.+?)\*\*\s*\(id:([^)]+)\)/.exec(line);
    if (match?.[1] && match[2]) fields.set(match[1].trim(), match[2]);
  }
  return fields;
}

/**
 * Parse an options field's predefined option values from `GET /tags/{id}/schema`
 * markdown into `fieldId -> (optionText -> optionId)`. Options render as indented
 * children under their field header:
 *
 *   - **Item Type** (id:24IpEaa3OT6S):: Options
 *     - Report (id:_CHKhUWwV09I)
 *
 * Used so sync can write an options value BY ID via `setFieldOption` (reusing the
 * predefined/auto-collected option node) instead of a string write — a string
 * write that collides with a pre-existing template-defined option name does NOT
 * dedupe, it mints a fresh detached value node every time (live-verified). Blank
 * option labels (trashed-seed leftovers) are skipped.
 */
export function parseTagSchemaOptions(
  markdown: string,
): Map<string, Map<string, string>> {
  const byField = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;

  for (const line of markdown.split('\n')) {
    const header = /^\s*-\s*\*\*(.+?)\*\*\s*\(id:([^)]+)\)\s*::\s*(.*)$/.exec(
      line,
    );
    if (header) {
      // Only options-typed fields carry selectable option children.
      if (header[2] && /^Options\b/.test(header[3] ?? '')) {
        current = new Map();
        byField.set(header[2], current);
      } else {
        current = null;
      }
      continue;
    }

    if (current) {
      const option = /^\s+-\s*(.+?)\s*\(id:([^)]+)\)\s*$/.exec(line);
      const text = option?.[1]?.trim();
      if (option?.[2] && text) current.set(text, option[2]);
    }
  }

  return byField;
}

/** Node ids of any seed placeholder options still present in the schema markdown. */
export function parseSeedOptionIds(markdown: string): string[] {
  const ids: string[] = [];
  const pattern = new RegExp(
    `^\\s*-\\s*${SEED_OPTION_LABEL}\\s*\\(id:([^)]+)\\)`,
  );
  for (const line of markdown.split('\n')) {
    const match = pattern.exec(line);
    if (match?.[1]) ids.push(match[1]);
  }
  return ids;
}

export async function ensureSchema(
  client: TanaClient,
  config: SchemaConfig,
  { workspaceId, optionSeeds = {} }: EnsureSchemaOptions,
): Promise<ResolvedSchema> {
  const tags = await client.listWorkspaceTags(workspaceId);
  const tagIdByName = new Map(tags.map((tag) => [tag.name, tag.id]));

  const resolveOrCreateTag = async (name: string): Promise<string> => {
    const existing = tagIdByName.get(name);
    if (existing) return existing;
    const created = await client.createTag(workspaceId, { name });
    tagIdByName.set(name, created.tagId);
    return created.tagId;
  };

  // The reference tag, then the auxiliary tags. Entity tags must exist before
  // any instance field is created (they supply its sourceTagId).
  const tagId = await resolveOrCreateTag(config.tagName);
  const entityTagIds: Record<EntityTag, string> = {
    Person: await resolveOrCreateTag(config.entityTags.Person),
    Organization: await resolveOrCreateTag(config.entityTags.Organization),
  };

  const tagSchemaMarkdown = await client.getTagSchema(tagId);
  const existingFields = parseTagSchemaFields(tagSchemaMarkdown);
  // Predefined/auto-collected option values per options field, captured from the
  // same schema read so sync can write options by id (see parseTagSchemaOptions).
  const optionsByFieldId = parseTagSchemaOptions(tagSchemaMarkdown);

  const fields: Partial<Record<FieldKey, ResolvedField>> = {};
  let createdTransientSeed = false;
  for (const field of config.fields) {
    if (!field.enabled) continue;

    const entry = CATALOG_BY_KEY[field.key];
    // A blank name means "use the catalog default" (the prefs placeholder).
    const name = effectiveFieldName(field.key, field.name);
    let id = existingFields.get(name);
    if (!id) {
      const created = await client.addField(tagId, {
        name,
        dataType: entry.dataType,
        isMultiValue: entry.multiValue,
        sourceTagId: entry.sourceTag
          ? entityTagIds[entry.sourceTag]
          : undefined,
        options: optionsForField(entry, optionSeeds[field.key]),
      });
      id = created.fieldId;
      existingFields.set(name, id);
      if (entry.transientSeed) createdTransientSeed = true;
    }
    fields[field.key] = { name, id };
  }

  // Entity options fields were seeded with a placeholder to satisfy the API;
  // trash those seeds now so only real references remain. One extra read,
  // skipped entirely on steady-state syncs (nothing new created).
  if (createdTransientSeed) {
    const seedIds = parseSeedOptionIds(await client.getTagSchema(tagId));
    for (const seedId of seedIds) await client.trash(seedId);
  }

  // The reference tag's `Annotations` container field — annotation nodes are
  // imported under it (see `syncAnnotations`). Structural, not a CATALOG field,
  // so it's always ensured here regardless of the per-field sync toggles.
  let annotationsFieldId = existingFields.get(REFERENCE_ANNOTATIONS_FIELD_NAME);
  if (!annotationsFieldId) {
    const created = await client.addField(tagId, {
      name: REFERENCE_ANNOTATIONS_FIELD_NAME,
      dataType: 'plain',
    });
    annotationsFieldId = created.fieldId;
  }

  // Annotation tags (highlight/comment/image), each with an `Annotation` URL
  // field for the PDF back-link and a `Page` field for the page label.
  // Independent of the reference fields above, so resolved last. Each field is
  // keyed off the tag's own schema markdown, so re-running is idempotent even
  // though addField makes a global def.
  const resolveAnnotationTag = async (
    name: string,
  ): Promise<ResolvedAnnotationTag> => {
    const annTagId = await resolveOrCreateTag(name);
    const annFields = parseTagSchemaFields(await client.getTagSchema(annTagId));

    let annotationFieldId = annFields.get(ANNOTATION_FIELD_NAME);
    if (!annotationFieldId) {
      const created = await client.addField(annTagId, {
        name: ANNOTATION_FIELD_NAME,
        dataType: 'url',
      });
      annotationFieldId = created.fieldId;
    }

    let pageFieldId = annFields.get(ANNOTATION_PAGE_FIELD_NAME);
    if (!pageFieldId) {
      const created = await client.addField(annTagId, {
        name: ANNOTATION_PAGE_FIELD_NAME,
        dataType: 'plain',
      });
      pageFieldId = created.fieldId;
    }

    let orderFieldId = annFields.get(ANNOTATION_ORDER_FIELD_NAME);
    if (!orderFieldId) {
      const created = await client.addField(annTagId, {
        name: ANNOTATION_ORDER_FIELD_NAME,
        dataType: 'number',
      });
      orderFieldId = created.fieldId;
    }

    return { tagId: annTagId, annotationFieldId, pageFieldId, orderFieldId };
  };
  const annotationTags: Record<AnnotationKind, ResolvedAnnotationTag> = {
    highlight: await resolveAnnotationTag(config.annotationTags.highlight),
    comment: await resolveAnnotationTag(config.annotationTags.comment),
    image: await resolveAnnotationTag(config.annotationTags.image),
  };

  return {
    workspaceId,
    tagId,
    tagName: config.tagName,
    entityTagIds,
    entityTagNames: { ...config.entityTags },
    annotationTags,
    annotationsFieldId,
    fields,
    optionsByFieldId,
  };
}

/**
 * The options seed to create an options field with (the API rejects an empty
 * list). Entity fields get a throwaway placeholder (trashed afterward); other
 * options fields (Item Type) get the caller's seed, falling back to the catalog
 * default. Non-options fields get nothing.
 */
function optionsForField(
  entry: CatalogEntry,
  override: string[] | undefined,
): string[] | undefined {
  if (entry.dataType !== 'options') return undefined;
  if (entry.transientSeed) return [SEED_OPTION_LABEL];
  return override?.length ? override : entry.optionSeed;
}
