-- Add MCQ columns to exam_questions table for structured exam prep
-- These columns are needed for WASSCE/BECE past question ingestion

ALTER TABLE exam_questions ADD COLUMN options TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN correct_answer TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN explanation TEXT DEFAULT '';
