-- =============================================================================
-- HOSPITAL OPERATING SOFTWARE (HOS) — IMMUTABLE CLINICAL RECORD & AUDIT TRIGGERS
-- Enforces Rule 27 & Rule 28 at the PostgreSQL database engine level:
-- Signed clinical records and finalized prescriptions cannot be silently overwritten
-- or deleted; modifications must be recorded via ClinicalNoteAddendum.
-- =============================================================================

CREATE OR REPLACE FUNCTION clinical.prevent_signed_clinical_note_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."isImmutable" = TRUE THEN
    RAISE EXCEPTION 'MEDICO_LEGAL_VIOLATION: Signed clinical note (%) is immutable and cannot be deleted.', OLD.id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."isImmutable" = TRUE THEN
    IF NEW."chiefComplaint" IS DISTINCT FROM OLD."chiefComplaint"
       OR NEW."historyOfPresentIllness" IS DISTINCT FROM OLD."historyOfPresentIllness"
       OR NEW."assessmentAndPlan" IS DISTINCT FROM OLD."assessmentAndPlan"
       OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash" THEN
      RAISE EXCEPTION 'MEDICO_LEGAL_VIOLATION: Signed clinical note (%) cannot be overwritten. Create a ClinicalNoteAddendum instead.', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_signed_clinical_note_mutation ON clinical."ClinicalNote";
CREATE TRIGGER trg_prevent_signed_clinical_note_mutation
BEFORE UPDATE OR DELETE ON clinical."ClinicalNote"
FOR EACH ROW EXECUTE FUNCTION clinical.prevent_signed_clinical_note_mutation();

CREATE OR REPLACE FUNCTION identity.prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'COMPLIANCE_VIOLATION: AuditLog table is append-only. UPDATE and DELETE are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON identity."AuditLog";
CREATE TRIGGER trg_prevent_audit_log_mutation
BEFORE UPDATE OR DELETE ON identity."AuditLog"
FOR EACH ROW EXECUTE FUNCTION identity.prevent_audit_log_mutation();
