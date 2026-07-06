# Malicious HTML

The following must NOT execute or render as active content:

<script>alert('xss')</script>

<img src="x" onerror="alert('xss')" />

<a href="javascript:alert('xss')">click me</a>

Normal **markdown** after the payload should still render.
