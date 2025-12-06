"""
AI Corrector Integration
=========================
Integrates with OpenAI GPT-4 to provide intelligent menu corrections
based on SOP rules and best practices.

Now includes dish allergen database integration for intelligent allergen suggestions.
"""

import os
from typing import Optional, List
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import dish allergen database
try:
    from dish_allergen_db import (
        lookup_dish,
        search_dishes,
        export_for_ai_prompt,
        infer_allergens_from_ingredients,
        ALLERGEN_CODES
    )
    DISH_DB_AVAILABLE = True
except ImportError:
    DISH_DB_AVAILABLE = False


class AICorrector:
    """
    Handles AI-powered text correction using OpenAI's API.
    """
    
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4o"):
        """
        Initialize the AI corrector.
        
        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var
            model: The model to use (default: gpt-4o)
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY environment variable.")
        
        self.client = OpenAI(api_key=self.api_key)
        self.model = model
        self.system_prompt = self._build_system_prompt()
    
    def _build_system_prompt(self) -> str:
        """
        Build the system prompt for menu corrections.
        """
        return """You are an expert menu editor for RSH Design. Your task is to correct menu item text according to strict formatting guidelines.

CRITICAL RULES:
1. Return ONLY the corrected text - no explanations, no comments, no markdown

2. PRESERVE EXISTING CAPITALIZATION - BE VERY CONSERVATIVE:
   - DO NOT change the capitalization of dish names, section headers, or titles
   - DO NOT lowercase words that are already capitalized (they are intentional)
   - DO NOT change "The Spark", "El Primer Encuentro", "Chilean Sea Bass", etc.
   - Only change capitalization if something is ALL CAPS that shouldn't be
   - Keep descriptions after the dish name in their original case

3. Fix ONLY clear spelling errors:
   - "tartar" → "tartare" (for raw fish/meat preparations)
   - "pre-fix" or "prefix" → "prix fixe" (French term for fixed-price menu)
   - "avacado" → "avocado"
   - "mozarella" → "mozzarella"
   - "parmesian" → "parmesan"
   - "Ceasar/Cesar" → "Caesar"

4. Formatting rules:
   - DO NOT change ingredient separators - keep commas as commas, keep hyphens as hyphens
   - DO NOT split compound words (yuzu-lime, cacao-ancho, cucumber-cilantro, huitlacoche-stuffed)
   - Dual prices: use " | " (space-bar-space) to separate two prices, not "/"
   - Enforce diacritics: jalapeño, crème brûlée, purée, soufflé, flambéed, etc.
   - Add asterisk (*) after items containing raw or undercooked ingredients (raw fish, tartare, carpaccio, caviar, oysters, raw egg)

5. DO NOT CHANGE:
   - Section headers like "The Spark – "El Primer Encuentro""
   - Dish names like "Chilean Sea Bass en Pipián Verde", "Tuna Tartare Tostada"
   - Title capitalization like "A Love Story", "Chocolate, Rose & Raspberry"
   - Words like "one" in "Choose one"
   - Compound words with hyphens (yuzu-lime, cacao-ancho, huitlacoche-stuffed)

6. If the text is already correct, return it UNCHANGED

EXAMPLES:
Input: "Tuna Tartar Tostada, avocado mousse, hibiscus ponzu D,G"
Output: "Tuna Tartare Tostada, avocado mousse, hibiscus ponzu * D,G"

Input: "Filete de Wagyu, australian Wagyu tenderloin, soft quail egg"
Output: "Filete de Wagyu, australian Wagyu tenderloin, soft quail egg *"

Input: "The Spark – "El Primer Encuentro""
Output: "The Spark – "El Primer Encuentro""

Input: "Chilean Sea Bass en Pipián Verde, seared chilean sea bass"
Output: "Chilean Sea Bass en Pipián Verde, seared chilean sea bass"

Input: "Chocolate, Rose & Raspberry, dark chocolate tart"
Output: "Chocolate, Rose & Raspberry, dark chocolate tart"

Input: "roasted plantain purée, shaved truffle D,N"
Output: "roasted plantain purée, shaved truffle D,N"
"""
    
    def correct_text(self, text: str) -> str:
        """
        Correct a single menu item text using AI.
        
        Args:
            text: The original menu text
            
        Returns:
            The corrected text
        """
        if not text.strip():
            return text
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": text}
                ],
                temperature=0.1,  # Low temperature for consistent corrections
                max_tokens=500
            )
            
            corrected = response.choices[0].message.content.strip()
            return corrected
            
        except Exception as e:
            print(f"Error correcting text: {e}")
            # Return original text if correction fails
            return text
    
    def correct_with_context(self, text: str, sop_rules: Optional[str] = None, restaurant: Optional[str] = None) -> str:
        """
        Correct text with additional SOP context and dish database knowledge.
        
        Args:
            text: The original menu text
            sop_rules: Optional additional SOP rules to include
            restaurant: Optional restaurant identifier for dish lookups
            
        Returns:
            The corrected text
        """
        if not text.strip():
            return text
        
        # Build context-aware prompt
        user_message = text
        
        # Add dish database context if available
        dish_context = self._get_dish_context(text, restaurant)
        
        if sop_rules or dish_context:
            context_parts = []
            if sop_rules:
                context_parts.append(f"SOP Context:\n{sop_rules}")
            if dish_context:
                context_parts.append(f"Known Dish Allergens:\n{dish_context}")
            user_message = f"{chr(10).join(context_parts)}\n\nMenu Item:\n{text}"
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_message}
                ],
                temperature=0.1,
                max_tokens=500
            )
            
            corrected = response.choices[0].message.content.strip()
            return corrected
            
        except Exception as e:
            print(f"Error correcting text: {e}")
            return text
    
    def _get_dish_context(self, text: str, restaurant: Optional[str] = None) -> str:
        """
        Get dish database context for allergen suggestions.
        
        Args:
            text: The menu item text
            restaurant: Optional restaurant identifier
            
        Returns:
            Context string with known allergen information
        """
        if not DISH_DB_AVAILABLE:
            return ""
        
        context_parts = []
        
        # Try to extract dish name (usually first part before comma or dash)
        dish_name = text.split(',')[0].split(' - ')[0].strip()
        
        # Look up in database
        known_dish = lookup_dish(dish_name, restaurant)
        if known_dish:
            allergens = ','.join(known_dish['allergens'])
            context_parts.append(f"Known: {dish_name} = {allergens} (confidence: {known_dish['confidence']:.0%})")
        
        # Also infer from ingredients
        inferred = infer_allergens_from_ingredients(text)
        if inferred:
            inferred_str = ','.join(inferred)
            context_parts.append(f"Inferred from ingredients: {inferred_str}")
        
        return '\n'.join(context_parts)
    
    def suggest_allergens(self, dish_name: str, description: str, restaurant: Optional[str] = None) -> List[str]:
        """
        Suggest allergens for a dish based on database + AI inference.
        
        Args:
            dish_name: Name of the dish
            description: Dish description/ingredients
            restaurant: Optional restaurant identifier
            
        Returns:
            List of suggested allergen codes
        """
        suggested = set()
        
        if DISH_DB_AVAILABLE:
            # Check database first
            known = lookup_dish(dish_name, restaurant)
            if known and known['confidence'] > 0.7:
                return known['allergens']
            
            # Infer from ingredients
            inferred = infer_allergens_from_ingredients(f"{dish_name} {description}")
            suggested.update(inferred)
        
        # Use AI for additional suggestions if needed
        if not suggested:
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": """You are an allergen expert. Given a dish name and description, identify likely allergens.
Return ONLY comma-separated allergen codes:
D=Dairy, N=Nuts, G=Gluten, V=Vegetarian, S=Vegan, E=Eggs, F=Fish, C=Crustaceans, SE=Sesame, SY=Soy, M=Mustard

Example: D,N,G"""},
                        {"role": "user", "content": f"Dish: {dish_name}\nDescription: {description}"}
                    ],
                    temperature=0.1,
                    max_tokens=50
                )
                
                ai_codes = response.choices[0].message.content.strip().upper().split(',')
                for code in ai_codes:
                    code = code.strip()
                    if DISH_DB_AVAILABLE and code in ALLERGEN_CODES:
                        suggested.add(code)
                    elif code in ['D', 'N', 'G', 'V', 'S', 'E', 'F', 'C', 'SE', 'SY', 'M']:
                        suggested.add(code)
                        
            except Exception as e:
                print(f"Error getting AI allergen suggestions: {e}")
        
        return sorted(suggested)


class BatchAICorrector:
    """
    Handles batch corrections more efficiently by processing multiple
    items in a single API call.
    """
    
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4o"):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not found.")
        
        self.client = OpenAI(api_key=self.api_key)
        self.model = model
        self.system_prompt = self._build_system_prompt()
    
    def _build_system_prompt(self) -> str:
        return """You are an expert menu editor. You will receive multiple menu items separated by "|||".
Return the corrected items in the SAME ORDER, also separated by "|||".

RULES:
- PRESERVE EXISTING CAPITALIZATION - do not change dish names, section headers, or titles
- Fix only clear spelling errors: tartar→tartare, avacado→avocado, mozarella→mozzarella, parmesian→parmesan, Ceasar→Caesar, pre-fix→prix fixe
- DO NOT change ingredient separators - keep commas and hyphens as they are
- Dual prices: use " | " (space-bar-space), not "/"
- Enforce diacritics: jalapeño, crème brûlée, purée, soufflé, flambéed
- Add asterisk (*) for raw/undercooked items (tartare, carpaccio, raw fish, caviar, raw egg)
- If an item is correct, return it UNCHANGED
- Return ONLY the corrected items, no other text

Example:
Input: "Tuna Tartar Tostada, avocado mousse D,G|||The Spark – "El Primer Encuentro""
Output: "Tuna Tartare Tostada, avocado mousse * D,G|||The Spark – "El Primer Encuentro""
"""
    
    def correct_batch(self, texts: list[str]) -> list[str]:
        """
        Correct multiple texts in a single API call.
        
        Args:
            texts: List of original texts
            
        Returns:
            List of corrected texts in the same order
        """
        if not texts:
            return []
        
        # Join texts with delimiter
        batch_input = "|||".join(texts)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": batch_input}
                ],
                temperature=0.1,
                max_tokens=2000
            )
            
            corrected_batch = response.choices[0].message.content.strip()
            corrected_texts = corrected_batch.split("|||")
            
            # Ensure we have the same number of outputs as inputs
            if len(corrected_texts) != len(texts):
                print(f"Warning: Expected {len(texts)} outputs, got {len(corrected_texts)}")
                # Fall back to original texts
                return texts
            
            return corrected_texts
            
        except Exception as e:
            print(f"Error in batch correction: {e}")
            return texts


# Example usage and testing
if __name__ == "__main__":
    # Test with a simple example
    try:
        corrector = AICorrector()
        
        test_texts = [
            "Guacamole - Fresh avacado, lime, cilantro - $12",
            "Ceasar Salad - Romaine lettuce, parmesian cheese - $14",
            "Margherita Pizza - tomato sauce, mozarella, basil - $16"
        ]
        
        print("Testing AI Corrector:")
        print("-" * 60)
        for text in test_texts:
            corrected = corrector.correct_text(text)
            print(f"Original:  {text}")
            print(f"Corrected: {corrected}")
            print()
        
    except ValueError as e:
        print(f"Error: {e}")
        print("\nTo use this module, set your OpenAI API key:")
        print("export OPENAI_API_KEY='your-api-key-here'")

