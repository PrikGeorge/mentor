package ru.mentor.platform.identity;

public record LegacyPasswordHash(String algorithm, int N, int r, int p, String saltBase64, String hashBase64) {}
