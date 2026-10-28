"""Filter reserved internal markers from a copy; never alter stored rental state."""
import re

_MARKERS = re.compile(
    r'(?:\[|&#91;|&#x5b;)(?:Rental OS (?:(?!\]|&#93;|&#x5d;)[^\r\n<])*|Klynx metadata:[A-Za-z0-9_]+:[A-Za-z0-9_=-]+)(?:\]|&#93;|&#x5d;)',
    re.I,
)


def customer_note(note):
    return _MARKERS.sub('', note or '')
