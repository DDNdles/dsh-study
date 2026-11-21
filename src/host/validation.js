import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

const schemaDir = new URL('../../schemas/', import.meta.url)
const ajv = new Ajv2020({ allErrors: true, strict: false })

function readSchema(name) {
  return JSON.parse(fs.readFileSync(new URL(name, schemaDir), 'utf8'))
}

export const manifestSchema = readSchema('manifest.schema.json')
export const metaSchema = readSchema('meta.schema.json')
export const questionSchema = readSchema('question.schema.json')
export const taxonomySchema = readSchema('taxonomy.schema.json')

const validateManifest = ajv.compile(manifestSchema)
const validateMeta = ajv.compile(metaSchema)
const validateQuestion = ajv.compile(questionSchema)
const validateTaxonomy = ajv.compile(taxonomySchema)

function describeErrors(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ')
}

export function assertManifest(value) {
  if (!validateManifest(value)) throw new Error(`Invalid manifest.json: ${describeErrors(validateManifest)}`)
  const codes = new Set()
  for (const course of value.courses) {
    if (codes.has(course.code)) throw new Error(`Duplicate course code in manifest: ${course.code}`)
    codes.add(course.code)
    for (const field of ['meta', 'taxonomy', 'questions']) assertSafeRelative(course.paths[field])
  }
  return value
}

export function assertMeta(value, courseCode) {
  if (!validateMeta(value)) throw new Error(`Invalid meta.json: ${describeErrors(validateMeta)}`)
  if (courseCode && value.code !== courseCode) {
    throw new Error(`Meta course ${value.code} does not match ${courseCode}`)
  }
  assertSafeRelative(value.files.questions)
  assertSafeRelative(value.files.taxonomy)
  return value
}

export function assertQuestion(value, courseCode) {
  if (!validateQuestion(value)) throw new Error(`Invalid question ${value?.id ?? '(unknown)'}: ${describeErrors(validateQuestion)}`)
  if (courseCode && value.course_code !== courseCode) {
    throw new Error(`Question ${value.id} belongs to ${value.course_code}, expected ${courseCode}`)
  }
  return value
}

export function assertTaxonomy(value, courseCode) {
  if (!validateTaxonomy(value)) throw new Error(`Invalid taxonomy.json: ${describeErrors(validateTaxonomy)}`)
  if (courseCode && value.course_code !== courseCode) {
    throw new Error(`Taxonomy course ${value.course_code} does not match ${courseCode}`)
  }
  const ids = new Set()
  for (const node of value.nodes) {
    if (ids.has(node.id)) throw new Error(`Duplicate taxonomy node: ${node.id}`)
    if (node.parent_id && !ids.has(node.parent_id)) {
      throw new Error(`Taxonomy node ${node.id} references a missing or later parent ${node.parent_id}`)
    }
    ids.add(node.id)
  }
  return value
}

export function assertSafeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new Error(`Unsafe manifest path: ${String(value)}`)
  }
  const parts = value.split('/')
  if (parts.some(part => part === '..' || part === '.' || part === '')) {
    throw new Error(`Unsafe manifest path: ${value}`)
  }
  return value
}

export function safeChild(root, relative) {
  assertSafeRelative(relative)
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, ...relative.split('/'))
  if (!resolved.startsWith(resolvedRoot + path.sep)) throw new Error(`Path escapes source root: ${relative}`)
  return resolved
}
