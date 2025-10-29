"""
AI Corrector Integration
=========================
Integrates with OpenAI GPT-4 to provide intelligent menu corrections
based on SOP rules and best practices.
"""

import os
from typing import Optional
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


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
2. Preserve the original structure and capitalization style
3. Fix spelling errors (e.g., "avacado" → "avocado")
4. Ensure proper formatting:
   - Item names should be in Title Case
   - Descriptions use sentence case
   - Prices follow items with proper formatting
5. Maintain the original punctuation style (dashes, commas, etc.)
6. Do NOT add or remove major content - only fix errors
7. If the text is already correct, return it unchanged

EXAMPLES:
Input: "Guacamole - Fresh avacado, lime, cilantro - $12"
Output: "Guacamole - Fresh avocado, lime, cilantro - $12"

Input: "Ceasar Salad - Romaine lettuce, parmesian cheese - $14"
Output: "Caesar Salad - Romaine lettuce, parmesan cheese - $14"

Input: "Margherita Pizza - tomato sauce, mozarella, basil"
Output: "Margherita Pizza - Tomato sauce, mozzarella, basil"
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
    
    def correct_with_context(self, text: str, sop_rules: Optional[str] = None) -> str:
        """
        Correct text with additional SOP context.
        
        Args:
            text: The original menu text
            sop_rules: Optional additional SOP rules to include
            
        Returns:
            The corrected text
        """
        if not text.strip():
            return text
        
        # Build context-aware prompt
        user_message = text
        if sop_rules:
            user_message = f"SOP Context:\n{sop_rules}\n\nMenu Item:\n{text}"
        
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
- Fix spelling errors
- Maintain original capitalization style
- Keep the same structure
- Return ONLY the corrected items, no other text
- If an item is correct, return it unchanged

Example:
Input: "Guacamole - Fresh avacado|||Ceasar Salad - Romaine lettuce"
Output: "Guacamole - Fresh avocado|||Caesar Salad - Romaine lettuce"
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

