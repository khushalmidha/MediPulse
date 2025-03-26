import { useEffect, useState } from "react";
import {useNavigate} from "react-router-dom";
import CommunityCard from "../components/CommunityCard";
import { useAuth } from "../context/AuthContext";

const CommunityForm = () => {
	return (
		<>
		<CommunityCard/>
		</>
	);
};

export default CommunityForm;
