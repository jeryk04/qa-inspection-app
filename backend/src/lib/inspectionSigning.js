// Writes the signature row and the status update in one transaction. Order
// matters: the signature must be inserted while the inspection is still
// in_progress, before the status update, to satisfy the trg_status_requires_signature
// / trg_signature_requires_status triggers in schema.sql (see comments there).
function signInspectionStatus(db, { inspectionId, userId, status, conditionalReason = null }) {
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO signatures (inspection_id, user_id, action) VALUES (?, ?, ?)").run(
      inspectionId,
      userId,
      status
    );
    db.prepare("UPDATE inspections SET status = ?, conditional_reason = ?, updated_by = ? WHERE id = ?").run(
      status,
      conditionalReason,
      userId,
      inspectionId
    );
  });
  tx();
}

module.exports = { signInspectionStatus };
