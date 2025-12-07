"""
Known Correction Pairs
======================
This file contains terminology pairs that the training system should
recognize as valid corrections, even if they only appear once.

Add new pairs here as you discover them during training reviews.
The training pipeline automatically imports this file.

Format: (original, corrected)
- Add BOTH directions if the correction is bidirectional
- Example: ('mayo', 'aioli'), ('aioli', 'mayo')
"""

# Terminology preferences (bidirectional)
KNOWN_PAIRS = {
    # Sauce/condiment terms
    ('mayo', 'aioli'), ('aioli', 'mayo'),
    
    # Abbreviations
    ('bbq', 'barbeque'), ('barbeque', 'bbq'),
    ('bbq', 'barbecue'), ('barbecue', 'bbq'),
    
    # Raw preparations
    ('tartare', 'tartar'), ('tartar', 'tartare'),
    
    # Diacritics - French terms
    ('puree', 'purée'), ('purée', 'puree'),
    ('flambe', 'flambé'), ('flambé', 'flambe'),
    ('cafe', 'café'), ('café', 'cafe'),
    ('creme', 'crème'), ('crème', 'creme'),
    ('souffle', 'soufflé'), ('soufflé', 'souffle'),
    ('saute', 'sauté'), ('sauté', 'saute'),
    ('entree', 'entrée'), ('entrée', 'entree'),
    ('pate', 'pâté'), ('pâté', 'pate'),
    ('naive', 'naïve'), ('naïve', 'naive'),
    
    # Diacritics - Spanish terms
    ('jalapeno', 'jalapeño'), ('jalapeño', 'jalapeno'),
    ('habanero', 'habañero'), ('habañero', 'habanero'),
    ('pina', 'piña'), ('piña', 'pina'),
    ('nino', 'niño'), ('niño', 'nino'),
    ('ano', 'año'), ('año', 'ano'),
    
    # Common misspellings
    ('cesar', 'caesar'), ('caesar', 'cesar'),
    ('ceasar', 'caesar'), ('caesar', 'ceasar'),
    ('parmesan', 'parmigiano'), ('parmigiano', 'parmesan'),
    ('mozarella', 'mozzarella'), ('mozzarella', 'mozarella'),
    ('cappucino', 'cappuccino'), ('cappuccino', 'cappucino'),
    ('expresso', 'espresso'), ('espresso', 'expresso'),
    
    # Spelling variations
    ('yogurt', 'yoghurt'), ('yoghurt', 'yogurt'),
    ('donut', 'doughnut'), ('doughnut', 'donut'),
    ('ketchup', 'catsup'), ('catsup', 'ketchup'),
    
    # Term standardization
    ('shrimp', 'prawn'), ('prawn', 'shrimp'),
}

# Common abbreviations that should be expanded
KNOWN_ABBREVIATIONS = {
    'bbq': 'barbeque',
    'msg': 'monosodium glutamate',
    'evoo': 'extra virgin olive oil',
    'oj': 'orange juice',
    'pb': 'peanut butter',
    'gf': 'gluten free',
    'v': 'vegetarian',
    'vg': 'vegan',
}


def is_known_pair(original: str, corrected: str) -> bool:
    """Check if this is a known correction pair."""
    orig_lower = original.lower().strip()
    corr_lower = corrected.lower().strip()
    return (orig_lower, corr_lower) in KNOWN_PAIRS


def is_known_abbreviation(text: str) -> bool:
    """Check if this is a known abbreviation."""
    return text.lower().strip() in KNOWN_ABBREVIATIONS

