/**
 * Types for a built #reference node, plus serialization to Tana Paste text.
 *
 * Layout (2-space indents):
 *   - <Title> #reference
 *     - <Field>:: <value>
 *     - [[Multi-word Field]]:: <value>
 *     - Creators::
 *       - [[Name #Person]]
 *       - [[Org Name #Organization]]
 *
 * Field labels: single-word names go bare (Container::), multi-word names are
 * bracketed ([[Item Type]]::) per Tana Paste syntax. Date-typed values use the
 * [[date:YYYY-MM-DD]] form (verified to populate a Date-typed field).
 */

import type { EntityTag } from './constants';

export type TanaScalarType =
  | 'plain'
  | 'url'
  | 'number'
  | 'date'
  | 'options'
  | 'item';

export type TanaFieldType = TanaScalarType | 'links' | 'optionList';

export type TanaLink = { name: string; tag: EntityTag };

export type TanaField =
  | { name: string; id: string; type: TanaScalarType; value: string }
  | { name: string; id: string; type: 'links'; links: TanaLink[] }
  // Multi-value options field with plain-text values (one node per value),
  // e.g. Tags and Collections.
  | { name: string; id: string; type: 'optionList'; values: string[] };

export type TanaReferenceNode = {
  title: string;
  tag: string;
  tagId: string;
  fields: TanaField[];
};

function fieldLabel(name: string): string {
  return name.includes(' ') ? `[[${name}]]` : name;
}

function scalarValueText(field: {
  type: TanaScalarType;
  value: string;
}): string {
  switch (field.type) {
    case 'date':
      return `[[date:${field.value}]]`;
    case 'url':
      // Emit a markdown link [url](url) so paste renders a clickable URL node.
      // Tana only renders markdown links on import (paste), not via the API — so
      // the update path sends the raw URL (plain text) and the user re-runs Tana's
      // "Iterate and convert URLs to URL nodes" to re-link changed URLs (see README).
      return `[${field.value}](${field.value})`;
    default:
      // plain, number, options, and item (already a markdown link) pass through.
      return field.value;
  }
}

/** Render one entity link as Tana reference markup: `[[Name #Person]]`. */
export function linkMarkup(link: TanaLink): string {
  return `[[${link.name} #${link.tag}]]`;
}

export function toTanaPaste(
  node: TanaReferenceNode,
  { withHeader = true }: { withHeader?: boolean } = {},
): string {
  const lines: string[] = [];
  if (withHeader) lines.push('%%tana%%');
  lines.push(`- ${node.title} #${node.tag}`);

  for (const field of node.fields) {
    const label = fieldLabel(field.name);
    if (field.type === 'links') {
      lines.push(`  - ${label}::`);
      for (const link of field.links) {
        lines.push(`    - ${linkMarkup(link)}`);
      }
    } else if (field.type === 'optionList') {
      // One child node per option value (multi-value options field).
      lines.push(`  - ${label}::`);
      for (const value of field.values) {
        lines.push(`    - ${value}`);
      }
    } else {
      lines.push(`  - ${label}:: ${scalarValueText(field)}`);
    }
  }

  return lines.join('\n');
}
