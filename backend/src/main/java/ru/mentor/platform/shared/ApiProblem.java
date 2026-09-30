package ru.mentor.platform.shared;

import java.util.Map;

public record ApiProblem(int status, String code, String message, Map<String,String> fieldErrors, String requestId) {}
