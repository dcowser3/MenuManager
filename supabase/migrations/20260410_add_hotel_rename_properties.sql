-- Add hotel column to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS hotel VARCHAR(255);

-- Update names and hotel values
UPDATE properties SET name = 'Anchor & Brine - Marriott Tampa Water Street - Tampa', hotel = 'Marriott Tampa Water Street' WHERE name = 'Anchor & Brine - Tampa';
UPDATE properties SET name = 'Aqimero - Ritz-Carlton - Philadelphia', hotel = 'Ritz-Carlton' WHERE name = 'Aqimero - Philadelphia';
UPDATE properties SET name = 'Bayou & Bottle - Four Seasons - Houston', hotel = 'Four Seasons' WHERE name = 'Bayou & Bottle - Houston';
UPDATE properties SET name = 'Casa Chi - InterContinental - Chicago', hotel = 'InterContinental' WHERE name = 'Casa Chi - Chicago';
UPDATE properties SET name = 'Cayao - Four Seasons Cabo Del Sol - Los Cabos', hotel = 'Four Seasons Cabo Del Sol' WHERE name = 'Cayao - Los Cabos';
UPDATE properties SET name = 'Ciclo - Four Seasons - Austin', hotel = 'Four Seasons' WHERE name = 'Ciclo - Austin';
UPDATE properties SET name = 'Coraluz - Four Seasons Cabo Del Sol - Los Cabos', hotel = 'Four Seasons Cabo Del Sol' WHERE name = 'Coraluz - Los Cabos';
UPDATE properties SET name = 'Ironwood - Fairmont Scottsdale Princess - Scottsdale', hotel = 'Fairmont Scottsdale Princess' WHERE name = 'Ironwood - Scottsdale';
UPDATE properties SET name = 'La Hacienda - Fairmont Scottsdale Princess - Scottsdale', hotel = 'Fairmont Scottsdale Princess' WHERE name = 'La Hacienda - Scottsdale';
UPDATE properties SET name = 'Live Oak - Four Seasons - Austin', hotel = 'Four Seasons' WHERE name = 'Live Oak - Austin';
UPDATE properties SET name = 'Lona - Westin - Fort Lauderdale', hotel = 'Westin' WHERE name = 'Lona - Fort Lauderdale';
UPDATE properties SET name = 'Lona - Noelle - Nashville', hotel = 'Noelle' WHERE name = 'Lona - Nashville';
UPDATE properties SET name = 'Lona - Marriott Tampa Water Street - Tampa', hotel = 'Marriott Tampa Water Street' WHERE name = 'Lona - Tampa';
UPDATE properties SET name = 'Maya - Le Royal Meridien - Dubai', hotel = 'Le Royal Meridien' WHERE name = 'Maya - Dubai';
UPDATE properties SET name = 'Raya - Ritz-Carlton Laguna Niguel - Laguna Niguel', hotel = 'Ritz-Carlton Laguna Niguel' WHERE name = 'Raya - Laguna Niguel';
UPDATE properties SET name = 'Sidecut - Four Seasons - Whistler', hotel = 'Four Seasons' WHERE name = 'Sidecut - Whistler';
UPDATE properties SET name = 'Sora - Four Seasons Cabo Del Sol - Los Cabos', hotel = 'Four Seasons Cabo Del Sol' WHERE name = 'Sora - Los Cabos';
UPDATE properties SET name = 'Stoke & Rye - Westin Riverfront - Avon', hotel = 'Westin Riverfront' WHERE name = 'Stoke & Rye - Avon';
UPDATE properties SET name = 'Toro - Fairmont Millennium Park - Chicago', hotel = 'Fairmont Millennium Park' WHERE name = 'Toro - Chicago';
UPDATE properties SET name = 'Toro - Hotel Clio - Denver', hotel = 'Hotel Clio' WHERE name = 'Toro - Denver';
UPDATE properties SET name = 'Toro - Six Senses Kocatas Mansions - Istanbul', hotel = 'Six Senses Kocatas Mansions' WHERE name = 'Toro - Istanbul';
UPDATE properties SET name = 'Toro - St. Regis Kanai - Riviera Maya', hotel = 'St. Regis Kanai' WHERE name = 'Toro - Riviera Maya';
UPDATE properties SET name = 'Toro - Fairmont Scottsdale Princess - Scottsdale', hotel = 'Fairmont Scottsdale Princess' WHERE name = 'Toro - Scottsdale';
UPDATE properties SET name = 'Toro - Viceroy - Snowmass', hotel = 'Viceroy' WHERE name = 'Toro - Snowmass';
UPDATE properties SET name = 'Toro Toro - Grosvenor House - Dubai', hotel = 'Grosvenor House' WHERE name = 'Toro Toro - Dubai';
UPDATE properties SET name = 'Toro Toro - Worthington Renaissance - Fort Worth', hotel = 'Worthington Renaissance' WHERE name = 'Toro Toro - Fort Worth';
UPDATE properties SET name = 'Toro Toro - Four Seasons - Houston', hotel = 'Four Seasons' WHERE name = 'Toro Toro - Houston';
UPDATE properties SET name = 'Toro Toro - InterContinental - Miami', hotel = 'InterContinental' WHERE name = 'Toro Toro - Miami';
UPDATE properties SET name = 'Zengo - Kempinski - Doha', hotel = 'Kempinski' WHERE name = 'Zengo - Doha';
UPDATE properties SET name = 'Zengo - Le Royal Meridien - Dubai', hotel = 'Le Royal Meridien' WHERE name = 'Zengo - Dubai';

-- Delete RSH Corporate Asset if it exists
DELETE FROM properties WHERE name = 'RSH Corporate Asset';

-- Drop sort_order column — ordering is alphabetical by name
ALTER TABLE properties DROP COLUMN IF EXISTS sort_order;
DROP INDEX IF EXISTS idx_properties_active_order;
CREATE INDEX IF NOT EXISTS idx_properties_active_name ON properties(is_active, name);
