// Who actually performed a Data Sheet -- not just whose account clicked
// "create". QC or an admin often opens a blank sheet that an Operator then
// fills in and signs (inspections.created_by is still the opener), so
// crediting created_by puts the wrong name on the work.
//
// Priority: whoever entered the readings (the one with the most saved
// changes, if several people did), then whoever signed it last, then the
// creator. Returns a SQL expression for a user id; `alias` is the
// inspections table alias in the surrounding query.
const DATA_ENTRY_ACTIONS = "('measurements_saved', 'point_summaries_saved', 'sample_rows_saved')";

function performedBySql(alias = "i") {
  return `COALESCE(
    (SELECT a.user_id FROM audit_log a
      WHERE a.entity_type = 'inspection' AND a.entity_id = ${alias}.id
        AND a.action IN ${DATA_ENTRY_ACTIONS} AND a.user_id IS NOT NULL
      GROUP BY a.user_id
      ORDER BY SUM(COALESCE(CASE WHEN json_valid(a.details) THEN json_array_length(a.details, '$.changes') END, 1)) DESC,
               MAX(a.id) DESC
      LIMIT 1),
    (SELECT s.user_id FROM signatures s WHERE s.inspection_id = ${alias}.id
      ORDER BY s.signed_at DESC, s.id DESC LIMIT 1),
    ${alias}.created_by)`;
}

module.exports = { performedBySql, DATA_ENTRY_ACTIONS };
