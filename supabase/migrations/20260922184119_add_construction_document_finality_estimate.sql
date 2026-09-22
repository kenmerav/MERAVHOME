ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS finality_estimate text NOT NULL DEFAULT 'unclear',
  ADD COLUMN IF NOT EXISTS finality_confidence text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS finality_reason text,
  ADD COLUMN IF NOT EXISTS finality_estimated_at timestamptz,
  ADD COLUMN IF NOT EXISTS finality_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS finality_revision text,
  ADD COLUMN IF NOT EXISTS finality_document_date date,
  ADD COLUMN IF NOT EXISTS finality_method text NOT NULL DEFAULT 'legacy_rules',
  ADD COLUMN IF NOT EXISTS finality_pdf_text_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finality_override text,
  ADD COLUMN IF NOT EXISTS finality_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS finality_overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL;

ALTER TABLE public.project_documents
  DROP CONSTRAINT IF EXISTS project_documents_finality_estimate_check,
  ADD CONSTRAINT project_documents_finality_estimate_check
    CHECK (finality_estimate IN ('likely_final', 'likely_not_final', 'unclear')),
  DROP CONSTRAINT IF EXISTS project_documents_finality_confidence_check,
  ADD CONSTRAINT project_documents_finality_confidence_check
    CHECK (finality_confidence IN ('high', 'medium', 'low')),
  DROP CONSTRAINT IF EXISTS project_documents_finality_override_check,
  ADD CONSTRAINT project_documents_finality_override_check
    CHECK (finality_override IS NULL OR finality_override IN ('final', 'in_progress', 'superseded')),
  DROP CONSTRAINT IF EXISTS project_documents_finality_method_check,
  ADD CONSTRAINT project_documents_finality_method_check
    CHECK (finality_method IN ('rules', 'rules_and_ai', 'legacy_rules'));

UPDATE public.project_documents
SET
  finality_estimate = 'likely_not_final',
  finality_confidence = 'high',
  finality_reason = 'The attachment name uses draft, review, preliminary, or progress-set wording.',
  finality_evidence = jsonb_build_array(jsonb_build_object('source', 'filename', 'text', coalesce(file_name, title))),
  finality_estimated_at = now()
WHERE coalesce(file_name, title) ~* '\m(not[[:space:]]+final|draft|preliminary|progress[[:space:]]+(set|print)|for[[:space:]]+review|review[[:space:]]+set|redlines?|markups?|schematic|concept(ual)?|working[[:space:]]+set|[0-9]{2}[[:space:]]*%[[:space:]]*(set|complete|documents?|drawings?))\M';

UPDATE public.project_documents
SET
  finality_estimate = 'likely_final',
  finality_confidence = 'high',
  finality_reason = 'The attachment name uses final, permit-set, or issued-for-construction wording.',
  finality_evidence = jsonb_build_array(jsonb_build_object('source', 'filename', 'text', coalesce(file_name, title))),
  finality_estimated_at = now()
WHERE finality_estimate = 'unclear'
  AND coalesce(file_name, title) ~* '\m(final|issued[[:space:]]+for[[:space:]]+construction|ifc|permit[[:space:]]+set|signed[[:space:]]+and[[:space:]]+sealed|record[[:space:]]+set|as[-[:space:]]?built)\M';

WITH latest_email_evidence AS (
  SELECT DISTINCT ON (document.id)
    document.id,
    source.body_text
  FROM public.project_documents AS document
  JOIN public.marvin_sources AS source
    ON source.metadata ->> 'project_document_id' = document.id::text
  WHERE source.external_provider = 'gmail_attachment'
  ORDER BY document.id, source.occurred_at DESC NULLS LAST
)
UPDATE public.project_documents AS document
SET
  finality_estimate = CASE
    WHEN evidence.body_text ~* '\m(not[[:space:]]+final|draft|preliminary|progress[[:space:]]+(set|print)|for[[:space:]]+review|review[[:space:]]+set|redlines?|markups?|schematic|concept(ual)?|working[[:space:]]+set|[0-9]{2}[[:space:]]*%[[:space:]]*(set|complete|documents?|drawings?))\M'
      THEN 'likely_not_final'
    WHEN evidence.body_text ~* '\m(final|issued[[:space:]]+for[[:space:]]+construction|ifc|permit[[:space:]]+set|signed[[:space:]]+and[[:space:]]+sealed|record[[:space:]]+set|as[-[:space:]]?built)\M'
      THEN 'likely_final'
    ELSE 'unclear'
  END,
  finality_confidence = CASE
    WHEN evidence.body_text ~* '\m(not[[:space:]]+final|draft|preliminary|progress[[:space:]]+(set|print)|for[[:space:]]+review|review[[:space:]]+set|redlines?|markups?|schematic|concept(ual)?|working[[:space:]]+set|[0-9]{2}[[:space:]]*%[[:space:]]*(set|complete|documents?|drawings?)|final|issued[[:space:]]+for[[:space:]]+construction|ifc|permit[[:space:]]+set|signed[[:space:]]+and[[:space:]]+sealed|record[[:space:]]+set|as[-[:space:]]?built)\M'
      THEN 'medium'
    ELSE 'low'
  END,
  finality_reason = CASE
    WHEN evidence.body_text ~* '\m(not[[:space:]]+final|draft|preliminary|progress[[:space:]]+(set|print)|for[[:space:]]+review|review[[:space:]]+set|redlines?|markups?|schematic|concept(ual)?|working[[:space:]]+set|[0-9]{2}[[:space:]]*%[[:space:]]*(set|complete|documents?|drawings?))\M'
      THEN 'The accompanying email describes the document as a draft, review, or progress set.'
    WHEN evidence.body_text ~* '\m(final|issued[[:space:]]+for[[:space:]]+construction|ifc|permit[[:space:]]+set|signed[[:space:]]+and[[:space:]]+sealed|record[[:space:]]+set|as[-[:space:]]?built)\M'
      THEN 'The accompanying email describes the document as final or issued for construction.'
    ELSE 'The attachment name and email do not clearly say whether this is the final set.'
  END,
  finality_evidence = CASE
    WHEN evidence.body_text ~* '\m(not[[:space:]]+final|draft|preliminary|progress[[:space:]]+(set|print)|for[[:space:]]+review|review[[:space:]]+set|redlines?|markups?|schematic|concept(ual)?|working[[:space:]]+set|[0-9]{2}[[:space:]]*%[[:space:]]*(set|complete|documents?|drawings?)|final|issued[[:space:]]+for[[:space:]]+construction|ifc|permit[[:space:]]+set|signed[[:space:]]+and[[:space:]]+sealed|record[[:space:]]+set|as[-[:space:]]?built)\M'
      THEN jsonb_build_array(jsonb_build_object('source', 'email', 'text', left(evidence.body_text, 320)))
    ELSE '[]'::jsonb
  END,
  finality_estimated_at = now()
FROM latest_email_evidence AS evidence
WHERE document.id = evidence.id
  AND document.finality_estimate = 'unclear';

UPDATE public.project_documents
SET
  finality_reason = coalesce(
    finality_reason,
    'No email context or clear final/draft wording was available.'
  ),
  finality_estimated_at = coalesce(finality_estimated_at, now());
