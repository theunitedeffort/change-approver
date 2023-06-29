import {Icon, Box, Button, TextButton, SelectButtons, initializeBlock, useRecordActionData, useBase, useRecordById, useRecords, expandRecord} from '@airtable/blocks/ui';
import React, { useState, createContext, useContext } from "react";

import './style.css';

const RESPONSES_TABLE = "tblXy0hiHoda5UVSR";
const UNITS_TABLE = "tblWoxbMLr5iedJ3W"; //"tblRtXBod9CC0mivK";  <- production table
const REJECTED_CHANGES_TABLE = "tblLykRU1MNNAHv7f";
const HOUSING_DATABASE_TABLE = "tblq3LUpHcY0ISzxZ"; //"tbl8LUgXQoTYEw2Yh" <- production table

const ctx = createContext();

function Change({field, change, targetTable, targetRecord, rejectTable}) {
  const oldRender = (
    <>
      <span className="remove">
        {formatFieldValue(field, change.existing)}
      </span>
      &nbsp;
    </>
  );
  const options = [
    { value: "reject", label: <Icon name="x" size={16} /> },
    { value: "neutral", label: " " },
    { value: "approve", label: <Icon name="check" size={16} /> },
  ];
  const [value, setValue] = useState(options[1].value);
  return (
    <div className="change">
      <Button icon="trash" variant="danger" aria-label="Reject" onClick={() => {
        rejectTable.createRecordAsync({"KEY": change.key})
      }} />
      &nbsp;
      <Button icon="thumbsUp" variant="primary" aria-label="Approve" onClick={() => {
        // convertForField(field, newVal);
        targetTable.updateRecordAsync(targetRecord, {[field.name]: convertForField(field, change.updated)});
      }} />
{/*      <SelectButtons
        className="approval_options"
        value={value}
        onChange={newValue => setValue(newValue)}
        options={options}
        width="100px"
      />*/}
      &nbsp;
      <strong>{field.name}</strong>:&nbsp;
      {change.existing ? oldRender : ""}
      <span className="add">
        {formatFieldValue(field, change.updated)}
      </span>
    </div>
  );
}

function BaseUnit({header, children}) {
  return (
    <div className="unit">
      <h3>
        {header}
      </h3>
      {children}
    </div>
  );
}

function DeletedUnit({deletedId}) {
  const header = <span className="remove_highlight">Deleted Unit ID {deletedId}</span>;
  return <BaseUnit header={header}/>;
}

function Unit({unit, fieldMap}) {
  let unitHeading = <span className="add_highlight">New Unit</span>;
  if (unit.ID) {
    unitHeading = `Unit ID ${unit.ID}`;
  }
  if (!Object.keys(unit.changes).length) {
    return null;
  }
  return (
    <BaseUnit header={unitHeading}>
      {Object.keys(unit.changes).map(fieldName => {
        return <Change
          field={fieldMap[fieldName]}
          change={unit.changes[fieldName]}
        />
      })}
    </BaseUnit>
  );
}

function Metadata({response, housing}) {
  let userRender = "";
  let notesRender = "";
  if (response.rawJson.user_name) {
    userRender = (
      <>
        Submitted by {response.rawJson.user_name}<br/>
      </>
    );
  }
  if (response.rawJson.userNotes) {
    notesRender = (
      <>
        Notes to reviewer: "{formatFieldValue({type:"multilineText"}, response.rawJson.userNotes)}"<br/>
      </>
    );
  }
  return (
    <>
    ID {response.housing.ID}<br/>
    Display ID {housing[response.housing.ID].getCellValueAsString("DISPLAY_ID")}<br/>
    {userRender}
    {notesRender}
    </>
  );
}

function Apartment({response, housing, fieldMap, unitsFieldMap, housingTable, rejectTable, approvalCallback}) {
  // Find any newly deleted units by comparing the unit IDs in the response
  // data with the unit IDs in Airtable for this apartment.
  const existingUnits = housing[response.housing.ID].getCellValue("UNITS");
  let existingUnitIds = [];
  // For some reason getCellValue can return null instead of an empty list of linked records.
  if (existingUnits) {
    existingUnitIds = existingUnits.map(u => u.name);
  }
  let updatedUnitIds = response.units.map(u => u.ID).filter(i => i);
  let deletedUnitIds = existingUnitIds.filter(i => !updatedUnitIds.includes(i));
  let changedUnits = response.units.filter(u => Object.keys(u.changes).length);
  // Even if no changes were submitted, ensure that notes to the reviewer make it into the summary email.
  if (!Object.keys(response.housing.changes).length &&
    !deletedUnitIds.length &&
    !changedUnits.length &&
    !response.rawJson.userNotes) {
    return null;
  }
  return (
    <div className="apartment">
      <h2>
        <TextButton onClick={() => expandRecord(housing[response.housing.ID])} icon="expand" size="xlarge">
          {housing[response.housing.ID].getCellValueAsString("APT_NAME")}
        </TextButton>
      </h2>
      <Metadata response={response} housing={housing} />
      {Object.keys(response.housing.changes).map(fieldName => {
        return (
          <Change
            field={fieldMap[fieldName]}
            change={response.housing.changes[fieldName]}
            targetTable={housingTable}
            targetRecord={housing[response.housing.ID]}
            rejectTable={rejectTable}
          />
        );
      })}
      {response.units.map(unit => {
        return <Unit unit={unit} fieldMap={unitsFieldMap}/>
      })}
      {deletedUnitIds.map(deletedId => {
        return <DeletedUnit deletedId={deletedId}/>
      })}
    </div>
  );
}

// Checks if all the fields in a form response object are empty.
// Empty arrays, empty objects, and empty strings are considered empty.
function isEmpty(obj) {
  let empty = true;
  for (const key in obj) {
    let value = obj[key];
    if (typeof value === "object") {
      empty = isEmpty(value);
    }
    else {
      empty = !value;
    }
    if (!empty) {
      break;
    }
  }
  return empty;
}

// Checks if two field values are equal.
// This function is required due to differences in how data
// is stored in Airtable and transmitted via the housing updates
// web form.  For example, Airtable stores phone numbers like
// (xxx) xxx-xxx but the web form supports many phone number
// formats, e.g. xxx-xxx-xxxx.
function fieldValuesEqual(field, existingVal, updatedVal) {
  let existing = existingVal;
  let updated = updatedVal;
  if (field.type == "phoneNumber") {
    let phoneRegex = /[\s-()]/g
    existing = existing.replace(phoneRegex, "");
    updated = updated.replace(phoneRegex, "");
  } else if (field.type == "checkbox") {
    function standardizeCheckboxStr(val) {
      if (!val) {
        return "unchecked";
      }
      return "checked";
    }
    existing = standardizeCheckboxStr(existing);
    updated = standardizeCheckboxStr(updated);
  } else if(field.type == "number") {
    function standardizeNumberStr(val) {
      return parseFloat(val).toFixed(field.options.precision);
    }
    existing = standardizeNumberStr(existing);
    updated = standardizeNumberStr(updated);
  } else if (field.type == "multipleSelects") {
    function standardizeMultipleSelectsStr(val) {
      if (Array.isArray(val)) {
        return val.sort().join(", ");
      } else {
        let selectedArray = val.split(", ")
        return selectedArray.map(x => x.trim()).sort().join(", ");
      }
    }
    existing = standardizeMultipleSelectsStr(existingVal);
    updated = standardizeMultipleSelectsStr(updatedVal);
  } else if (field.type == "singleLineText" || field.type == "multilineText") {
    function standardizeStr(val) {
      return val.replace(/\s+/g, " ");
    }
    existing = standardizeStr(existing);
    updated = standardizeStr(updated);
  }
  return existing.trim() === updated.trim();
}

// Converts a string value to the proper type for writing to a field
function convertForField(field, val) {
  const strVal = val;
  const converted = field.convertStringToCellValue(strVal);
  if (converted === null && strVal) {
    throw(
      `Error converting ${JSON.stringify(val)} for storage in ${field.name}`);
  }
  return converted;
}

// Formats a field value for printing and display.
function formatFieldValue(field, val) {
  if (field.type == "checkbox") {
    if (val) {
      //return "&#9745"
      return "yes";
    } else {
      //return "&#9744"
      return "no";
    }
  } else if (field.type == "number") {
    let parsed = parseFloat(val);
    if (Number.isNaN(parsed)) {
      return val;
    }
    return parsed.toFixed(field.options.precision);
  } else if (field.type == "multipleSelects") {
    if (Array.isArray(val)) {
      return val.sort().join(", ");
    } else {
      let selectedArray = val.split(", ")
      return selectedArray.map(x => x.trim()).sort().join(", ");
    }
  } else if (field.type == "singleLineText" || field.type == "multilineText") {
    return val.replace(/\r/g, "").replace(/\n/g, "<br/>");
  }
  return val
}

function RecordActionDataDemoBlock() {
  // null if no buttons have been clicked, otherwise {recordId, viewId, tableId} corresponding
  // to the last click
  const recordActionData = useRecordActionData();

  if (recordActionData === null) {
    return <Box padding={2}>Click a button!</Box>
  }

  return <RecordActionData data={recordActionData} />;
}

function RecordActionData({data}) {
  const [pendingUpdates, setPendingUpdates] = useState([]);

  function handleApproval(change) {
    setPendingUpdates([
      ...pendingUpdates,
      change]);
  }

  const base = useBase();
  const table = base.getTableByIdIfExists(data.tableId);
  const view = table && table.getViewByIdIfExists(data.viewId);
  const record = useRecordById(view, data.recordId);

  if (!(table && view && record)) {
    return <Box padding={2}>Table, view or record was deleted.</Box>
  }

  const CAMPAIGN = record.getCellValueAsString("Campaign Key");

  // Make some table objects for use later.
  let changesTable = base.getTable(RESPONSES_TABLE);
  let housingDbTable = base.getTable(HOUSING_DATABASE_TABLE);
  let unitsTable = base.getTable(UNITS_TABLE);
  let rejectTable = base.getTable(REJECTED_CHANGES_TABLE);


  // Build the Airtable fields hash maps indexed by field name.
  let housingFieldsByName = {};
  let unitFieldsByName = {};
  for (const field of housingDbTable.fields) {
    housingFieldsByName[field.name] = field;
  }
  for (const field of unitsTable.fields) {
    unitFieldsByName[field.name] = field;
  }

  // Build the housing data hash map indexed by Airtable ID.
  let housing = {};
  let housingRecords = useRecords(housingDbTable);
  for (let record of housingRecords) {
    housing[record.getCellValueAsString("ID")] = record;
  }

  // Build the units data hash map indexed by Airtable ID.
  let units = {};
  let unitsRecords = useRecords(unitsTable);
  for (let record of unitsRecords) {
    units[record.getCellValueAsString("ID")] = record;
  }

  // Build the rejected changes list.
  let rejects = [];
  let rejectRecords = useRecords(rejectTable);
  for (const record of rejectRecords) {
    rejects.push(record.getCellValueAsString("KEY"));
  }
  console.log(rejects);

  // Get all form responses submitted to date.
  let formResponses = useRecords(changesTable,
    {fields: ["FORM_RESPONSE_JSON", "CAMPAIGN"],
    // Sort ascending by date added so that newer form responses will
    // overwrite older ones in our processing below.
    sorts: [{field: "DATETIME_ADDED", direction: "asc"}]}
  );

  // Build a map of form responses indexed by Airtable ID.
  let responseData = {};
  for (let record of formResponses) {
    if (record.getCellValueAsString("CAMPAIGN") !== CAMPAIGN) {
      // Only process records matching the campaign of interest.
      continue;
    }
    let response = JSON.parse(record.getCellValue("FORM_RESPONSE_JSON"));
    responseData[response.ID] = {housing: {}, units: {}, rawJson: response, responseRecordId: record.id};
    // Un-flatten form response data by nesting offering-level data inside
    // their parent unit and units-level data inside their parent apartment.
    // First, we sort data into apartment, unit, or offering-level.
    for (let formFieldName in response) {
      let [fieldName, unitIdx, offeringIdx] = formFieldName.split(":");
      if (unitIdx === undefined && offeringIdx === undefined) {
        // This is apartment-level data.
        responseData[response.ID].housing[fieldName] = response[formFieldName];
      } else {
        // The unit index is a index used in the form field names to distinguish
        // between identical field names for different unit listings.
        if (!responseData[response.ID].units[unitIdx]) {
          // This unit index has not been processed yet.  Add an entry to the map so
          // it's ready to accept form field values.
          responseData[response.ID].units[unitIdx] = {fields:{}, offerings:{}};
        }
        if (offeringIdx === undefined) {
          // This is unit-level data.
          responseData[response.ID].units[unitIdx].fields[fieldName] = response[formFieldName];
        } else {
          // This is offering-level data.
          // The offering index is a index used in the form field names to distinguish
          // between identical field names for different rent offer listings.
          // TODO: there may be a way to shorten this default object construction using ||
          let offerings = responseData[response.ID].units[unitIdx].offerings;
          if (!offerings[offeringIdx]) {
            // This offering index has not been processed yet.  Add an entry to the map so
            // it's ready to accept form field values.
            // TODO: why no fields property here?
            offerings[offeringIdx] = {};
          }
          offerings[offeringIdx][fieldName] = response[formFieldName];
        }
      }
    }

    // The data entry form has a flat structure, so there are many available "slots"
    // in the form for units.  It's likely that not every set of unit-level fields
    // will be filled. Prune units and offerings to only include those with data.
    // Note we iterate over a separate array of keys rather than the object itself
    // to avoid deleting stuff in the object we are iterating over.
    for (let unitIdx in Object.keys(responseData[response.ID].units)) {
      let unit = responseData[response.ID].units[unitIdx];
      // Remove any empty offerings first.
      for (let offeringIdx in Object.keys(unit.offerings)) {
        if (isEmpty(unit.offerings[offeringIdx])){
          delete unit.offerings[offeringIdx];
        }
      }
      // If the unit has no data left remove it as well.
      if (isEmpty(unit)) {
        delete responseData[response.ID].units[unitIdx];
      }
    }

    // The Airtable data does not nest offerings within units, but rather
    // stores each offering as a separate record in the Units table.  Flatten
    // our units structure here to match.
    let flatUnits = [];
    for (const unitIdx in responseData[response.ID].units) {
      let unit = responseData[response.ID].units[unitIdx];
      // TODO: (fixed...I think) If there are no offerings, nothing gets pushed!!
      if (Object.keys(unit.offerings).length == 0) {
        flatUnits.push(unit.fields);
      } else {
        for (const offeringIdx in unit.offerings) {
          let offering = unit.offerings[offeringIdx];
          let flatUnit = {...unit.fields, ...offering};
          flatUnits.push(flatUnit);
        }
      }
    }
    responseData[response.ID].units = flatUnits;
  }
  console.log(responseData);

  // Find differences between the form response data and the data stored in
  // Airtable.
  // need to handle differences in representation:
  //   multiselect ordering
  let changes = {};
  for (let housingId in responseData) {
    //changes[housingId] = {housing:{}, units:[]};
    responseData[housingId].housing.changes = {}
    for (let dbField in housingFieldsByName){
      if (!responseData[housingId].housing.hasOwnProperty(dbField)) {
        continue;
      }
      let existingVal = housing[housingId].getCellValueAsString(dbField);
      // TODO: Filter out changes that have been rejected in the past.
      // change key format is responseID:housingId:unitIdx:fieldName
      const changeKey = `${responseData[housingId].responseRecordId}:${housingId}:-:${dbField}`;
      let newVal = responseData[housingId].housing[dbField];
      if (rejects.includes(changeKey)) {
        console.log(`rejecting ${changeKey}`);
        newVal = existingVal;
      }
      if (!fieldValuesEqual(housingFieldsByName[dbField], existingVal, newVal)) {
        responseData[housingId].housing.changes[dbField] = {
          existing: existingVal, updated: newVal, key: changeKey};
      }
    }
    for (let [idx, unit] of responseData[housingId].units.entries()) {
      let unitChanges = {};
      let unitId = unit.ID || ""
      unit.changes = {};
      for (let dbField in unitFieldsByName) {
        if (!unit.hasOwnProperty(dbField)) {
          continue;
        }
        let existingVal = "";
        if (unitId) {
          existingVal = units[unitId].getCellValueAsString(dbField);
        }
        const changeKey = `${responseData[housingId].responseRecordId}:${housingId}:${idx}:${dbField}`;
        let newVal = unit[dbField];
        if (rejects.includes(changeKey)) {
          console.log(`rejecting ${changeKey}`);
          newVal = existingVal;
        }
        // TODO: possibly omit the 'existing' for new entries.
        if (!fieldValuesEqual(unitFieldsByName[dbField], existingVal, newVal)) {
          unit.changes[dbField] = {
            existing: existingVal, updated: newVal, key: changeKey};
        }
      }
    }
  }

  console.log(responseData);

  let htmlStrs = [];
  for (let housingId in responseData) {
    let changeStrs = [];
    let metadataStrs = [];
    // Render changes to the Housing Database table
    for (let fieldName in responseData[housingId].housing.changes) {
      changeStrs.push(`<p style="padding-left:1em"><strong>${fieldName}</strong>: <span style="color:red; text-decoration:line-through">${formatFieldValue(housingFieldsByName[fieldName], responseData[housingId].housing.changes[fieldName].existing)}</span> <span style="color:green">${formatFieldValue(housingFieldsByName[fieldName], responseData[housingId].housing.changes[fieldName].updated)}</span></p>`);
    }
    // Render changes to the Units table
    for (let unit of responseData[housingId].units) {
      let unitStrs = []
      let unitHeading = `<span style="background-color:#abf2bc">New Unit</span>`;
      if (unit.ID) {
        unitHeading = `Unit ID ${unit.ID}`;
      }
      for (let fieldName in unit.changes) {
        unitStrs.push(`<p style="padding-left:1em"><strong>${fieldName}</strong>: <span style="color:red; text-decoration:line-through">${formatFieldValue(unitFieldsByName[fieldName], unit.changes[fieldName].existing)}</span> <span style="color:green">${formatFieldValue(unitFieldsByName[fieldName], unit.changes[fieldName].updated)}</span></p>`);
      }
      if (unitStrs.length) {
        changeStrs.push(`<div style="border:solid #888 2px; border-radius:6px; margin:1em 1em 1em 2em; padding: 1em;"><h3>${unitHeading}</h3>${unitStrs.join("")}</div>`);
      }
    }
    // Render any newly deleted units by comparing the unit IDs in the response
    // data with the unit IDs in Airtable for this apartment.
    const existingUnits = housing[housingId].getCellValue("UNITS");
    let existingUnitIds = [];
    // For some reason getCellValue can return null instead of an empty list of linked records.
    if (existingUnits) {
      existingUnitIds = existingUnits.map(u => u.name);
    }
    let updatedUnitIds = responseData[housingId].units.map(u => u.ID).filter(i => i);
    let deletedUnitIds = existingUnitIds.filter(i => !updatedUnitIds.includes(i));
    for (let deletedUnitId of deletedUnitIds) {
      changeStrs.push(`<div style="border:solid #888 2px; border-radius:6px; margin:1em 1em 1em 2em; padding: 1em;"><h3><span style="background-color:#ffc0c0">Deleted Unit ID ${deletedUnitId}</span></h3></div>`);
    }

    // Even if no changes were submitted, ensure that notes to the reviwer make it into the summary email.
    if (changeStrs.length || responseData[housingId].rawJson.userNotes) {
      metadataStrs.push(`ID ${housingId}`);
      metadataStrs.push(`Display ID ${housing[housingId].getCellValueAsString("DISPLAY_ID")}`);
      if (responseData[housingId].rawJson.user_name){
        metadataStrs.push(`Submitted by ${responseData[housingId].rawJson.user_name}`);
      }
      if (responseData[housingId].rawJson.userNotes) {
        metadataStrs.push(`Notes to reviewer: "${formatFieldValue({type:"multilineText"}, responseData[housingId].rawJson.userNotes)}"`);
      }
      let recordLink = `https://airtable.com/apphE4mk8YDqyHM0I/tblq3LUpHcY0ISzxZ/viw8aa14PoQNBYQgX/${housing[housingId].id}?blocks=hide`
      htmlStrs.push(`<div style="border-bottom:solid #888 1px;"><h2><a href="${recordLink}" target="_blank" rel="noopener">${housing[housingId].getCellValueAsString("APT_NAME")}</a></h2>${metadataStrs.join("<br/>")}${changeStrs.join("")}</div>`);
    }
  }

  return (
    <Box padding={4} style={{height: "100vh", width: "100%"}}>
      {Object.keys(responseData).map(housingId => {
        return <Apartment
          response={responseData[housingId]}
          housing={housing}
          fieldMap={housingFieldsByName}
          unitsFieldMap={unitFieldsByName}
          housingTable={housingDbTable}
          rejectTable={rejectTable}
          approvalCallback={handleApproval} />
      })}
      {/*<div dangerouslySetInnerHTML={{__html: htmlStrs.join("")}} />*/}
    </Box>
  );
}

initializeBlock(() => <RecordActionDataDemoBlock />);