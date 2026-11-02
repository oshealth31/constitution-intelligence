-- Runs once, when the local database container is first created.
-- Creates a separate database for automated tests so tests never touch development data.
CREATE DATABASE constitution_test;
