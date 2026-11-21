export type QuestionType = "single" | "multi" | "blank" | "solve" | "proof";

export type AnswerOrigin = "official" | "community" | "ai";

export type SourceKind = "exam_paper" | "book" | "dataset" | "notes";

export type ExamKind = "midterm" | "final" | "makeup" | "quiz";

export type RightsClass =
  | "original"
  | "third_party_exam"
  | "third_party_textbook"
  | "third_party_notes"
  | "third_party_community"
  | "third_party_textbook_and_community";

export interface FigureRef {
  id: string;
  /** Course-relative POSIX path under courses/<course_code>/assets/, e.g. assets/fig-01.webp */
  path: string;
  alt: string;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
}

export interface QuestionOption {
  key: string;
  md: string;
  figures?: FigureRef[];
}

export interface QuestionRecord {
  id: string;
  course_code: string;
  schema_version: "1.0";
  type: QuestionType;
  stem: {
    md: string;
    figures: FigureRef[];
  };
  options: QuestionOption[];
  answer: {
    md: string;
    figures: FigureRef[];
    origin: AnswerOrigin;
    origin_detail: string;
  };
  solution: {
    md: string;
    steps: string[];
    figures: FigureRef[];
  };
  tags: {
    kp_ids: string[];
    keywords: string[];
    difficulty: 1 | 2 | 3 | 4 | 5;
  };
  source: {
    kind: SourceKind;
    batch: string;
    ref: string;
    year: number | null;
    term: string | null;
    exam_kind: ExamKind | null;
    url: string | null;
    rights: RightsClass;
  };
  quality: {
    quarantined: boolean;
    quarantine_reason: string | null;
    confidence: number | null;
    note: string | null;
    overlap_hint: string | null;
  };
}

export interface TaxonomyNode {
  id: string;
  parent_id: string | null;
  level: number;
  name: string;
  chapter_ref: string | null;
}

export interface TaxonomyFile {
  schema_version: "1.0";
  course_code: string;
  nodes: TaxonomyNode[];
}

export interface OriginCounts {
  official: number;
  community: number;
  ai: number;
}

export interface CourseMeta {
  schema_version: "1.0";
  code: string;
  name: string;
  name_en: string;
  department: string;
  category: string;
  description: string;
  stats: {
    total: number;
    quarantined: number;
    taxonomy_nodes: number;
    by_origin: OriginCounts;
    by_type: Record<string, number>;
    by_difficulty: Record<"1" | "2" | "3" | "4" | "5", number>;
    exam_years: number[];
  };
  batches: Array<{
    id: string;
    count: number;
    rights: RightsClass;
    description: string;
  }>;
  known_notes: string[];
  files: {
    questions: string;
    taxonomy: string;
  };
  sha256: {
    questions: string;
    taxonomy: string;
  };
}

export interface Manifest {
  name: string;
  schema_version: "1.0";
  data_version: string;
  updated_at: string;
  repository: string;
  asset_base_url: string | null;
  license: {
    code_and_schema: string;
    question_content: string;
  };
  stats: {
    courses: number;
    questions: number;
    quarantined: number;
    by_origin: OriginCounts;
  };
  courses: Array<{
    code: string;
    name: string;
    name_en: string;
    department: string;
    category: string;
    total: number;
    quarantined: number;
    by_origin: OriginCounts;
    exam_years: number[];
    paths: {
      meta: string;
      taxonomy: string;
      questions: string;
    };
    sha256: {
      meta: string;
      taxonomy: string;
      questions: string;
    };
  }>;
}
