'use strict';

/**
 * Definition of the All Candidates Bulk Import Schema columns, types, and validation rules.
 */
const CANDIDATE_IMPORT_SCHEMA = [
  { key: 'name',       label: 'Name',         required: true },
  { key: 'role',       label: 'Role',         required: true },
  { key: 'email',      label: 'e-mail',       required: true },
  { key: 'phone',      label: 'phone number', required: true },
  { key: 'resumeLink', label: 'resume link',  required: false },
  { key: 'college',    label: 'college',      required: false },
  { key: 'location',   label: 'location',     required: false },
  { key: 'course',     label: 'course',       required: false },
  { key: 'source',     label: 'source',       required: false },
  { key: 'company',    label: 'company',      required: false },
];

module.exports = {
  CANDIDATE_IMPORT_SCHEMA,
};
