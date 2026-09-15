from __future__ import annotations

import logging
import os
import re
from logging.handlers import RotatingFileHandler


class SecretRedactionFilter(logging.Filter):
    _patterns = (
        re.compile(r"(?i)(bearer\s+)[^\s]+"),
        re.compile(r"(?i)(token|secret|password|private[_ -]?key)(\s*[=:]\s*)[^\s,;]+"),
    )

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for pattern in self._patterns:
            message = pattern.sub(lambda match: f"{match.group(1)}[REDACTED]", message)
        record.msg = message
        record.args = ()
        return True


def configure_logging(log_dir: str) -> logging.Logger:
    os.makedirs(log_dir, mode=0o750, exist_ok=True)
    logger = logging.getLogger("ibkr_bridge")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s")
    redaction = SecretRedactionFilter()

    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "trading.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.addFilter(redaction)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.addFilter(redaction)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    return logger
