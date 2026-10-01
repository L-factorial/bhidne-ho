"""Conservative multilingual text checks; not a substitute for human reporting."""
import re
import unicodedata

# Whole-token/phrase matching avoids substring false positives (e.g. 'class').
# Keep this list reviewable; do not add remotely downloaded unreviewed patterns.
TERMS = ('motherfucker','fuck you','kill yourself','rape you','child porn',
         'मादरचोद','मुजी','माचिक्ने','machikne','madarchod','mujhi','muji')
TRANSLATE = str.maketrans({'@':'a','$':'s','0':'o','1':'i','3':'e','4':'a','5':'s','7':'t'})

def normalized(text):
    value=unicodedata.normalize('NFKC',text).casefold()
    value=''.join(c for c in value if unicodedata.category(c)!='Cf')
    return ' '.join(value.translate(TRANSLATE).split())

def validate_content(text):
    value=normalized(text)
    if any(re.search(r'(?<!\w)'+re.escape(term)+r'(?!\w)',value) for term in TERMS):
        raise ValueError('Please remove abusive or prohibited language.')
    return text
