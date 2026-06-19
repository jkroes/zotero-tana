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
  ANNOTATION_TAG_NAMES,
  CATALOG_BY_KEY,
  ENTITY_TAG_NAMES,
  effectiveFieldName,
  type AnnotationKind,
  type CatalogEntry,
  type EntityTag,
  type FieldKey,
} from './constants';

export type ResolvedField = { name: string; id: string };

/** A resolved annotation supertag plus its `Annotation` back-link field id. */
export type ResolvedAnnotationTag = {
  tagId: string;
  annotationFieldId: string;
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
  /** Annotation supertags (highlight/comment/image) + each one's link field id. */
  annotationTags: Record<AnnotationKind, ResolvedAnnotationTag>;
  /** Enabled fields only: catalog key -> resolved name + attribute id. */
  fields: Partial<Record<FieldKey, ResolvedField>>;
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
    Person: await resolveOrCreateTag(ENTITY_TAG_NAMES.Person),
    Organization: await resolveOrCreateTag(ENTITY_TAG_NAMES.Organization),
  };

  const existingFields = parseTagSchemaFields(await client.getTagSchema(tagId));

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

  // Annotation tags (highlight/comment/image), each with an `Annotation` URL
  // field for the PDF back-link. Independent of the reference fields above, so
  // resolved last. The field is keyed off each tag's own schema markdown, so
  // re-running is idempotent even though addField makes a global def.
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
    return { tagId: annTagId, annotationFieldId };
  };
  const annotationTags: Record<AnnotationKind, ResolvedAnnotationTag> = {
    highlight: await resolveAnnotationTag(ANNOTATION_TAG_NAMES.highlight),
    comment: await resolveAnnotationTag(ANNOTATION_TAG_NAMES.comment),
    image: await resolveAnnotationTag(ANNOTATION_TAG_NAMES.image),
  };

  return {
    workspaceId,
    tagId,
    tagName: config.tagName,
    entityTagIds,
    annotationTags,
    fields,
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
