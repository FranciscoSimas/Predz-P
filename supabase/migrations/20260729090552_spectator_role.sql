-- Phase 1: add the spectator enum value in its own transaction.
-- PostgreSQL requires a committed enum value before functions/policies can use it.

ALTER TYPE public.tournament_role ADD VALUE IF NOT EXISTS 'spectator';
